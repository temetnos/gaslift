// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Treasury is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    // Events
    event Deposited(
        bytes32 indexed dAppId,
        address indexed token,
        address indexed from,
        uint256 amount
    );
    event Withdrawn(
        bytes32 indexed dAppId,
        address indexed token,
        address indexed to,
        uint256 amount
    );
    event Pulled(
        bytes32 indexed dAppId,
        address indexed token,
        uint256 amount
    );

    // State
    mapping(bytes32 => mapping(address => uint256)) public balances;
    mapping(address => bool) public authorizedPaymasters;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner) public initializer {
        __Ownable_init(owner);
        __UUPSUpgradeable_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    modifier onlyPaymaster() {
        require(authorizedPaymasters[msg.sender], "Not authorized paymaster");
        _;
    }

    function setPaymaster(address paymaster, bool isAuthorized) external onlyOwner {
        authorizedPaymasters[paymaster] = isAuthorized;
    }

    function deposit(
        bytes32 dAppId,
        address token,
        uint256 amount
    ) external payable {
        require(dAppId != bytes32(0), "Invalid dApp ID");
        require(amount > 0, "Amount must be greater than 0");

        if (token == address(0)) {
            require(msg.value == amount, "ETH amount mismatch");
            balances[dAppId][token] += amount;
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            balances[dAppId][token] += amount;
        }

        emit Deposited(dAppId, token, msg.sender, amount);
    }

    function withdraw(
        bytes32 dAppId,
        address token,
        uint256 amount,
        address payable to
    ) external onlyOwner {
        require(amount > 0, "Amount must be greater than 0");
        require(to != address(0), "Invalid recipient");
        require(balances[dAppId][token] >= amount, "Insufficient balance");

        balances[dAppId][token] -= amount;

        if (token == address(0)) {
            (bool success, ) = to.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }

        emit Withdrawn(dAppId, token, to, amount);
    }

    function pull(
        bytes32 dAppId,
        address token,
        uint256 amount
    ) external onlyPaymaster {
        require(amount > 0, "Amount must be greater than 0");
        require(balances[dAppId][token] >= amount, "Insufficient balance");

        balances[dAppId][token] -= amount;
        emit Pulled(dAppId, token, amount);
    }

    function getBalance(
        bytes32 dAppId,
        address token
    ) external view returns (uint256) {
        return balances[dAppId][token];
    }

    // Required to receive ETH
    receive() external payable {}

    fallback() external payable {}
}
