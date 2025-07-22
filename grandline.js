const fs = require('fs');
const Web3 = require('web3');

// --- Configuration ---
const RPC_URL = 'https://testnet.dplabs-internal.com';
const PRIVATE_KEYS_FILE = 'private_keys.txt';

// Map of router addresses to their descriptions
const ROUTER_DESCRIPTIONS = {
    '0x1da9f40036bee3fda37ddd9bff624e1125d8991d': 'Minting Pharos Testnet badge',
    '0x7fb63bfd3ef701544bf805e88cb9d2efaa3c01a9': 'Minting Faroswap Testnet Badge#1',
	'0x2a469a4073480596b9deb19f52aa89891ccff5ce': 'Minting Faroswap Testnet Badge#2',
	'0xe71188df7be6321ffd5aaa6e52e6c96375e62793': 'Minting Zentra Testnet badge'
};
const ROUTER_ADDRESSES = Object.keys(ROUTER_DESCRIPTIONS);

// --- Web3 Setup ---
const web3 = new Web3(new Web3.providers.HttpProvider(RPC_URL));

/**
 * A simple delay function.
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Main function to process all private keys.
 */
async function main() {
    try {
        const privateKeys = fs.readFileSync(PRIVATE_KEYS_FILE, 'utf8')
            .split('\n')
            .map(pk => pk.trim())
            .filter(pk => pk.length > 0);

        if (privateKeys.length === 0) {
            console.log(`No private keys found in ${PRIVATE_KEYS_FILE}`);
            return;
        }

        console.log(`Found ${privateKeys.length} private key(s). Starting processing...`);

        // Process each private key sequentially
        for (let i = 0; i < privateKeys.length; i++) {
            const privateKey = privateKeys[i];
            await processPrivateKey(privateKey);

            if (i < privateKeys.length - 1) {
                await delay(10000); // 10-second delay
            }
        }
        console.log('\n🎉 All wallets have been processed.');
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.error(`Error: The file '${PRIVATE_KEYS_FILE}' was not found.`);
        } else {
            console.error("An error occurred during file reading:", error);
        }
    }
}

/**
 * For a single private key, loops through all router addresses and sends a transaction to each.
 */
async function processPrivateKey(privateKey) {
    try {
        const account = web3.eth.accounts.privateKeyToAccount(privateKey);
        const wallet_address = account.address;
        console.log(`\n================================================================`);
        console.log(`🔑 Processing Wallet: ${wallet_address}`);
        console.log(`================================================================`);

        let nonce = await web3.eth.getTransactionCount(wallet_address, 'latest');

        for (const routerAddress of ROUTER_ADDRESSES) {
            await sendClaimTransaction(privateKey, wallet_address, routerAddress, nonce);
            nonce++;
        }
    } catch (error) {
        console.error(`❌ A critical error occurred while getting wallet details: ${error.message}`);
    }
}

/**
 * Sends one claim transaction.
 */
async function sendClaimTransaction(privateKey, wallet_address, routerAddress, nonce) {
    const mintingMessage = ROUTER_DESCRIPTIONS[routerAddress.toLowerCase()] || `Claiming from ${routerAddress}`;
    console.log(`  -> ${mintingMessage}...`);

    try {
        const params = [
            wallet_address, "1", "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", "1000000000000000000",
            [
                [], "0", "115792089237316195423570985008687907853269984665640564039457584007913129639935",
                "0x0000000000000000000000000000000000000000"
            ],
            "0x"
        ];

        const encodedData = web3.eth.abi.encodeFunctionCall({
            name: 'claim',
            type: 'function',
            inputs: [
                { type: 'address', name: 'recipient' }, { type: 'uint256', name: 'amount' },
                { type: 'address', name: 'token' }, { type: 'uint256', name: 'nonce' },
                {
                    type: 'tuple', name: 'bridgeData',
                    components: [
                        { type: 'bytes32[]', name: 'proof' }, { type: 'uint256', name: 'expiry' },
                        { type: 'uint256', name: 'max' }, { type: 'address', name: 'root' }
                    ]
                },
                { type: 'bytes', name: 'signature' }
            ]
        }, params);

        const gasEstimate = await web3.eth.estimateGas({
            from: wallet_address, to: routerAddress, data: encodedData, value: web3.utils.toWei('1', 'ether')
        });

        const txObject = {
            from: wallet_address,
            to: routerAddress,
            value: web3.utils.toWei('1', 'ether'),
            chainId: 688688,
            data: encodedData,
            nonce: nonce,
            gasPrice: await web3.eth.getGasPrice(),
            gas: gasEstimate,
        };

        const signedTx = await web3.eth.accounts.signTransaction(txObject, privateKey);
        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        console.log(`     ✅ Success! Hash: ${receipt.transactionHash}`);

    } catch (error) {
        if (error.message && error.message.includes('execution reverted')) {
            console.log(`     ⚠️  Skipped (already minted or transaction reverted).`);
        } else {
            console.error(`     ❌ Failed. Reason: ${error.message}`);
        }
    }
}

// --- Run the script ---
main();