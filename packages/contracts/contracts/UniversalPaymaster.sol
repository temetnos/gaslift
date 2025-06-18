// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

interface IEntryPoint {
    function depositTo(address account) external payable;
    function getDepositInfo(address account) external view returns (uint112 totalDeposit, uint256 staked, uint112 unstakeDelaySec, uint64 withdrawTime);
    function getUserOpHash(UserOperation calldata userOp) external view returns (bytes32);
}

struct UserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    uint256 callGasLimit;
    uint256 verificationGasLimit;
    uint256 preVerificationGas;
    uint256 maxFeePerGas;
    uint256 maxPriorityFeePerGas;
    bytes paymasterAndData;
    bytes signature;
}

contract UniversalPaymaster is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // Constants
    uint256 public constant PRICE_DENOMINATOR = 1e18;
    uint256 public constant FEE_PERCENT = 12; // 12% fee
    uint256 public constant FEE_DENOMINATOR = 100;
    uint256 public constant MIN_STAKE = 0.1 ether;
    
    // State
    IEntryPoint public entryPoint;
    ITreasury public treasury;
    mapping(address => bool) public whitelistedTokens;
    mapping(address => AggregatorV3Interface) public priceFeeds;
    uint256 public minStake;
    
    // Events
    event TokenWhitelisted(address indexed token, bool whitelisted);
    event PriceFeedUpdated(address indexed token, address priceFeed);
    event MinStakeUpdated(uint256 minStake);
    event Deposited(address indexed sender, uint256 amount);
    event Withdrawn(address indexed sender, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _entryPoint, address _treasury, uint256 _minStake) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        
        require(_entryPoint != address(0), "Invalid entry point");
        require(_treasury != address(0), "Invalid treasury");
        
        entryPoint = IEntryPoint(_entryPoint);
        treasury = ITreasury(_treasury);
        minStake = _minStake;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function whitelistToken(address token, bool whitelist) external onlyOwner {
        whitelistedTokens[token] = whitelist;
        emit TokenWhitelisted(token, whitelist);
    }

    function setPriceFeed(address token, address priceFeed) external onlyOwner {
        require(whitelistedTokens[token], "Token not whitelisted");
        priceFeeds[token] = AggregatorV3Interface(priceFeed);
        emit PriceFeedUpdated(token, priceFeed);
    }

    function setMinStake(uint256 _minStake) external onlyOwner {
        minStake = _minStake;
        emit MinStakeUpdated(_minStake);
    }

    function deposit() external payable {
        require(msg.value > 0, "No ETH sent");
        entryPoint.depositTo{value: msg.value}(address(this));
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external onlyOwner {
        (uint256 totalDeposit,,,) = entryPoint.getDepositInfo(address(this));
        require(amount <= totalDeposit, "Insufficient balance");
        require(amount <= address(this).balance, "Insufficient contract balance");
        
        // Withdraw from EntryPoint
        (bool success,) = address(entryPoint).call(abi.encodeWithSignature("withdrawTo(address,uint256)", msg.sender, amount));
        require(success, "Withdraw failed");
        
        emit Withdrawn(msg.sender, amount);
    }

    function validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external view returns (bytes memory context, uint256 validationData) {
        require(msg.sender == address(entryPoint), "Not from EntryPoint");
        
        // Extract dAppId from paymasterAndData (first 32 bytes after the function selector)
        bytes32 dAppId;
        assembly {
            dAppId := calldataload(add(userOp.paymasterAndData.offset, 32))
        }
        
        // Verify token is whitelisted and has a price feed
        address token = address(bytes20(userOp.paymasterAndData[52:72]));
        require(whitelistedTokens[token], "Token not whitelisted");
        require(address(priceFeeds[token]) != address(0), "No price feed for token");
        
        // Calculate token amount needed based on ETH cost and token price
        uint256 tokenCost = getTokenCost(token, maxCost);
        
        // Check if dApp has sufficient balance
        uint256 dAppBalance = treasury.balances(dAppId, token);
        require(dAppBalance >= tokenCost, "Insufficient dApp balance");
        
        // Return context with dAppId and token
        return (abi.encode(dAppId, token), 0);
    }

    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost
    ) external {
        require(msg.sender == address(entryPoint), "Not from EntryPoint");
        
        // Decode context
        (bytes32 dAppId, address token) = abi.decode(context, (bytes32, address));
        
        // Calculate token amount to charge (including fee)
        uint256 tokenCost = getTokenCost(token, actualGasCost);
        uint256 fee = (tokenCost * FEE_PERCENT) / FEE_DENOMINATOR;
        uint256 totalCharge = tokenCost + fee;
        
        // Pull tokens from dApp's balance to treasury
        treasury.pull(dAppId, token, totalCharge);
        
        // Deposit ETH to EntryPoint to cover the gas cost
        entryPoint.depositTo{value: actualGasCost}(address(this));
    }

    function getTokenCost(address token, uint256 ethAmount) public view returns (uint256) {
        require(whitelistedTokens[token], "Token not whitelisted");
        
        // Get token/ETH price from Chainlink
        AggregatorV3Interface priceFeed = priceFeeds[token];
        require(address(priceFeed) != address(0), "No price feed for token");
        
        (, int256 price,,,) = priceFeed.latestRoundData();
        require(price > 0, "Invalid price");
        
        // Calculate token amount needed for the given ETH amount
        // tokenCost = (ethAmount * PRICE_DENOMINATOR) / (price / 1e8)
        return (ethAmount * PRICE_DENOMINATOR * 1e8) / uint256(price);
    }

    receive() external payable {}
}

interface ITreasury {
    function balances(bytes32 dAppId, address token) external view returns (uint256);
    function pull(bytes32 dAppId, address token, uint256 amount) external;
}
