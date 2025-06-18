// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script} from "forge-std/Script.sol";
import {UUPSProxy} from "../test/mocks/UUPSProxy.sol";
import {UniversalPaymaster} from "../src/UniversalPaymaster.sol";
import {Treasury} from "../src/Treasury.sol";

contract DeployScript is Script {
    // EntryPoint addresses (same across all networks)
    address constant ENTRY_POINT = 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789;
    
    // Price feed addresses (Base Sepolia)
    address constant BASE_ETH_USD_FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;
    address constant BASE_USDC_USD_FEED = 0xA2F78ab2355fe2f984D808B5CeE7Fd0F93Fc8A70;
    
    // Token addresses (Base Sepolia)
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    
    // Minimum stake amount (0.1 ETH)
    uint256 constant MIN_STAKE = 0.1 ether;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // Deploy Treasury
        Treasury treasuryImpl = new Treasury();
        UUPSProxy treasuryProxy = new UUPSProxy(
            address(treasuryImpl),
            abi.encodeWithSelector(Treasury.initialize.selector, msg.sender)
        );
        Treasury treasury = Treasury(address(treasuryProxy));

        // Deploy UniversalPaymaster
        UniversalPaymaster paymasterImpl = new UniversalPaymaster();
        UUPSProxy paymasterProxy = new UUPSProxy(
            address(paymasterImpl),
            abi.encodeWithSelector(
                UniversalPaymaster.initialize.selector,
                ENTRY_POINT,
                address(treasury),
                MIN_STAKE
            )
        );
        UniversalPaymaster paymaster = UniversalPaymaster(address(paymasterProxy));

        // Configure Treasury
        treasury.setPaymaster(address(paymaster), true);

        // Configure Paymaster
        paymaster.whitelistToken(USDC, true);
        paymaster.setPriceFeed(USDC, BASE_USDC_USD_FEED);
        
        // Stake ETH in EntryPoint
        paymaster.deposit{value: MIN_STAKE * 10}();

        vm.stopBroadcast();

        // Log deployed addresses
        console.log("Treasury Implementation:", address(treasuryImpl));
        console.log("Treasury Proxy:", address(treasury));
        console.log("Paymaster Implementation:", address(paymasterImpl));
        console.log("Paymaster Proxy:", address(paymaster));
    }
}
