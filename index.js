const fs = require('fs');
const Web3 = require('web3');
const axios = require('axios');

// Configuration
const INVITE_CODE = 'igTbAn078cxwfif2'; // Replace with your invite code
const RPC_URL = 'https://testnet.dplabs-internal.com';
const CHAIN_ID = 688688;

// New DEX configuration
const PHAROSWAP_ROUTER = '0x3541423f25a1ca5c98fdbcf478405d3f0aad1164';
const ZENITHFI_ROUTER = '0x1a4de519154ae51200b0ad7c90f7fac75547888a'; // Original router
const WETH_CONTRACT = '0x76aaaDA469D23216bE5f7C596fA25F282Ff9b364';

// Updated Stablecoin List
const STABLE_COINS = {
    USDC: '0x72df0bcd7276f2dFbAc900D1CE63c272C4BCcCED',
    USDT: '0xD4071393f8716661958F766DF660033b3d35fD29'
};

const DAILY_RUN_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in ms
let cycleStartTime = null;
let totalSwaps = 0; // Global swap counter
let totalSends = 0; // Global send counter

const commonHeaders = {
    'accept': 'application/json, text/plain, */*',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'accept-language': 'en-GB,en;q=0.6',
    'origin': 'https://testnet.pharosnetwork.xyz',
    'priority': 'u=1, i',
    'referer': 'https://testnet.pharosnetwork.xyz/',
    'sec-ch-ua': '"Chromium";v="136", "Brave";v="136", "Not.A/Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'sec-gpc': '1',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
};

const web3 = new Web3(RPC_URL);
let nextRunTime = null;

// Utility functions
function formatTime(ms) {
    return new Date(ms).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

function randomDelay(min = 10000, max = 20000) {
    const delayMs = Math.floor(Math.random() * (max - min + 1)) + min;
    console.log(`\n⌛ Next wallet delay: ${(delayMs/1000).toFixed(1)}s`);
    return new Promise(resolve => setTimeout(resolve, delayMs));
}

async function withRetry(fn, maxRetries = 5, backoffBase = 5000) {
    let attempt = 0;
    while (true) {
        try {
            return await fn();
        } catch (error) {
            if (attempt >= maxRetries) throw error;
            const delayMs = backoffBase * Math.pow(2, attempt);
            console.log(`Retrying in ${(delayMs/1000).toFixed(1)}s... (Attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            attempt++;
        }
    }
}

// Core functionality
function readPrivateKeys() {
    const keys = fs.readFileSync('private_keys.txt', 'utf-8')
        .split('\n')
        .map(pk => pk.trim())
        .filter(pk => pk !== '');

    console.log(`\n📂 Loaded ${keys.length} wallet${keys.length !== 1 ? 's' : ''}`);
    return keys;
}

async function loginUser(privateKey) {
    const account = web3.eth.accounts.privateKeyToAccount(privateKey);
    const signature = account.sign('pharos').signature;

    const response = await axios.post(
        `https://api.pharosnetwork.xyz/user/login?address=${account.address}&signature=${signature}&invite_code=${INVITE_CODE}`,
        null, {
            headers: {
                ...commonHeaders,
                'authorization': 'Bearer null',
                'content-length': '0'
            }
        }
    );

    if (response.data.code !== 0) {
        throw new Error(`Login failed: ${response.data.msg}`);
    }

    const jwt = response.data.data?.jwt || response.data.jwt;

    if (!jwt) {
        throw new Error('JWT token not found in login response');
    }

    return {
        address: account.address,
        token: jwt
    };
}

async function checkStatus(address, token) {
    const response = await axios.get(
        `https://api.pharosnetwork.xyz/sign/status?address=${address}`, {
            headers: {
                ...commonHeaders,
                'authorization': `Bearer ${token}`
            }
        }
    );
    return response.data.data.status;
}

async function fetchTaskStatus(address, token) {
    const response = await axios.get(
        `https://api.pharosnetwork.xyz/user/tasks?address=${address}`, {
            headers: {
                ...commonHeaders,
                'authorization': `Bearer ${token}`
            }
        }
    );

    const tasks = response.data.data.user_tasks || [];

    return {
        swapsCompleted: tasks.find(t => t.TaskId === 101)?.CompleteTimes || 0,
        sendsCompleted: tasks.find(t => t.TaskId === 103)?.CompleteTimes || 0,
        socialTasks: {
            201: tasks.find(t => t.TaskId === 201)?.CompleteTimes || 0,
            202: tasks.find(t => t.TaskId === 202)?.CompleteTimes || 0,
            203: tasks.find(t => t.TaskId === 203)?.CompleteTimes || 0,
            204: tasks.find(t => t.TaskId === 204)?.CompleteTimes || 0
        }
    };
}

async function verifySocialTasks(address, token, socialTasks) {
    const socialTaskIds = [201, 202, 203, 204];
    let verifiedCount = 0;

    for (const taskId of socialTaskIds) {
        if (socialTasks[taskId] > 0) {
            console.log(`⏩ Skipping task ${taskId} (already completed)`);
            continue;
        }

        try {
            console.log(`🔍 Verifying social task ${taskId}...`);
            await withRetry(async () => {
                await verifyTask(address, token, taskId, '0x');
            }, 3, 2000);

            console.log(`✅ Social task ${taskId} verified`);
            verifiedCount++;
        } catch (error) {
            console.error(`⚠️ Social task ${taskId} verification failed: ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return verifiedCount;
}

async function checkInUser(address, token) {
    try {
        const response = await axios.post(
            `https://api.pharosnetwork.xyz/sign/in?address=${address}`,
            address, {
                headers: {
                    ...commonHeaders,
                    'authorization': `Bearer ${token}`,
                    'content-type': 'text/plain'
                }
            }
        );

        if (response.data.code === 0) {
            console.log('✅ Daily check-in successful!');
            return true;
        } else if (response.data.code === 1) {
            console.log('⏩ Already checked in today');
            return true;
        } else {
            console.log('⚠️ Unexpected check-in response:', response.data);
            throw new Error(`Check-in failed: ${response.data.msg}`);
        }

    } catch (error) {
        if (error.response) {
            console.log('❌ Check-in error response:', error.response.data);
        } else {
            console.log('❌ Check-in error:', error.message);
        }
        throw error;
    }
}

async function performPharoswapSwap(privateKey, walletAddress) {
    const account = web3.eth.accounts.privateKeyToAccount(privateKey);
    web3.eth.accounts.wallet.add(account);

    try {
        const stableCoin = Object.values(STABLE_COINS)[Math.floor(Math.random() * Object.values(STABLE_COINS).length)];
        const isUSDT = stableCoin === STABLE_COINS.USDT;

        const ethAmount = (Math.random() * 0.0008 + 0.0001).toFixed(4);
        const amountInWei = web3.utils.toWei(ethAmount, 'ether');

        // Note: The provided calldata for mixSwap is highly specific and likely includes
        // time-sensitive or signature-related data that cannot be easily replicated.
        // This is a simplified approach using a standard swap function.
        // A full implementation of mixSwap would require deeper analysis of the DEX's contract.
        const deadline = Math.floor(Date.now() / 1000) + 600;
        const mixSwapData = web3.eth.abi.encodeFunctionCall({
            "name": "swapExactETHForTokens",
            "type": "function",
            "inputs": [{
                "internalType": "uint256",
                "name": "amountOutMin",
                "type": "uint256"
            }, {
                "internalType": "address[]",
                "name": "path",
                "type": "address[]"
            }, {
                "internalType": "address",
                "name": "to",
                "type": "address"
            }, {
                "internalType": "uint256",
                "name": "deadline",
                "type": "uint256"
            }]
        }, [
            '0',
            [WETH_CONTRACT, stableCoin],
            walletAddress,
            deadline
        ]);


        const tx = {
            from: walletAddress,
            to: PHAROSWAP_ROUTER,
            value: amountInWei,
            data: mixSwapData,
            gasPrice: await web3.eth.getGasPrice(),
            nonce: await web3.eth.getTransactionCount(walletAddress, 'pending'),
            chainId: CHAIN_ID
        };

        const estimatedGas = await web3.eth.estimateGas(tx);
        tx.gas = Math.floor(estimatedGas * 1.2);

        const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

        console.log(`\n✅ Pharoswap Successful:`);
        console.log(`Amount: ${ethAmount} PHRS → ${isUSDT ? 'USDT' : 'USDC'}`);
        console.log(`TX Hash: ${receipt.transactionHash}`);

        return receipt;

    } catch (error) {
        console.error('\n❌ Pharoswap Failed:', error.message);
        throw error;
    } finally {
        web3.eth.accounts.wallet.remove(account.address);
    }
}

async function performZenithfiSwap(privateKey, walletAddress) {
    const account = web3.eth.accounts.privateKeyToAccount(privateKey);
    web3.eth.accounts.wallet.add(account);

    try {
        const stableCoin = Object.values(STABLE_COINS)[Math.floor(Math.random() * Object.values(STABLE_COINS).length)];
        const isUSDT = stableCoin === STABLE_COINS.USDT;

        const ethAmount = (Math.random() * 0.0008 + 0.0001).toFixed(4);
        const amountInWei = web3.utils.toWei(ethAmount, 'ether');
        const amountBN = web3.utils.toBN(amountInWei);
        const amountHex = amountBN.toString(16).padStart(64, '0');

        const exactInputSingleData =
            '0x04e45aaf' +
            WETH_CONTRACT.slice(2).padStart(64, '0') +
            stableCoin.slice(2).padStart(64, '0') +
            '0000000000000000000000000000000000000000000000000000000000000bb8' +
            walletAddress.toLowerCase().slice(2).padStart(64, '0') +
            amountHex +
            '0000000000000000000000000000000000000000000000000000000000000000' +
            '0000000000000000000000000000000000000000000000000000000000000000';

        const deadline = Math.floor(Date.now() / 1000) + 600;
        const multicallData = web3.eth.abi.encodeFunctionCall({
            name: 'multicall',
            type: 'function',
            inputs: [{
                type: 'uint256',
                name: 'deadline'
            }, {
                type: 'bytes[]',
                name: 'data'
            }]
        }, [deadline, [exactInputSingleData]]);

        const tx = {
            from: walletAddress,
            to: ZENITHFI_ROUTER,
            value: amountInWei,
            data: multicallData,
            gasPrice: await web3.eth.getGasPrice(),
            nonce: await web3.eth.getTransactionCount(walletAddress, 'pending'),
            chainId: CHAIN_ID
        };

        const estimatedGas = await web3.eth.estimateGas(tx);
        tx.gas = Math.floor(estimatedGas * 1.2);

        const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

        console.log(`\n✅ Zenithfi Swap Successful:`);
        console.log(`Amount: ${ethAmount} PHRS → ${isUSDT ? 'USDT' : 'USDC'}`);
        console.log(`TX Hash: ${receipt.transactionHash}`);

        return receipt;

    } catch (error) {
        console.error('\n❌ Zenithfi Swap Failed:', error.message);
        throw error;
    } finally {
        web3.eth.accounts.wallet.remove(account.address);
    }
}


async function sendToRandomAddress(privateKey, walletAddress, token) {
    const account = web3.eth.accounts.privateKeyToAccount(privateKey);
    web3.eth.accounts.wallet.add(account);

    try {
        const randomAddress = web3.eth.accounts.create().address;

        const ethAmount = (Math.random() * 0.0008 + 0.0001).toFixed(4);
        const amountInWei = web3.utils.toWei(ethAmount, 'ether');

        const tx = {
            from: walletAddress,
            to: randomAddress,
            value: amountInWei,
            gasPrice: await web3.eth.getGasPrice(),
            nonce: await web3.eth.getTransactionCount(walletAddress, 'pending'),
            chainId: CHAIN_ID
        };

        const estimatedGas = await web3.eth.estimateGas(tx);
        tx.gas = Math.floor(estimatedGas * 1.2);

        const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

        console.log(`\n✅ Transfer Successful:`);
        console.log(`To: ${randomAddress}`);
        console.log(`Amount: ${ethAmount} ETH`);
        console.log(`TX Hash: ${receipt.transactionHash}`);

        console.log('🔍 Verifying send task...');
        await verifyTask(walletAddress, token, 103, receipt.transactionHash);
        console.log('✅ Send tx hash verified');

        return receipt;

    } catch (error) {
        console.error('\n❌ Transfer Failed:', error.message);
        throw error;
    } finally {
        web3.eth.accounts.wallet.remove(account.address);
    }
}

async function verifyTask(address, token, taskId, txHash) {
    return withRetry(async () => {
        try {
            const verifyUrl = `https://api.pharosnetwork.xyz/task/verify?address=${address}&task_id=${taskId}&tx_hash=${txHash}`;
            const headers = {
                ...commonHeaders,
                'authorization': `Bearer ${token}`
            };

            const response = await axios.post(
                verifyUrl,
                null, {
                    headers
                }
            );

            if (response.data.code !== 0) {
                throw new Error(`API Error: ${response.data.msg} (Code ${response.data.code})`);
            }

            return response.data.data.verified;
        } catch (error) {
            console.error(`⚠️ Verification Error: ${error.message}`);
            if (error.response) {
                console.error(`📄 Server Response: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }, 3, 3000);
}
async function processWallet(privateKey, index, total) {
    console.log(`\n══════════ Wallet ${index + 1}/${total} ══════════`);
    let swapSuccessCount = 0;
    let sendSuccessCount = 0;
    const SWAP_TARGET = 10;
    const SEND_TARGET = 10;

    try {
        const {
            address,
            token
        } = await withRetry(() => loginUser(privateKey));
        console.log(`✅ Authenticated: ${address.slice(0, 8)}...${address.slice(-4)}`);


        const status = await withRetry(() => checkStatus(address, token));
        console.log(`📊 Status Code: ${status}`);


        console.log('⚡ Performing check-in...');
        await withRetry(() => checkInUser(address, token), 5);


        const {
            swapsCompleted,
            sendsCompleted,
            socialTasks
        } = await withRetry(() => fetchTaskStatus(address, token));

        console.log(`\n📊 Social Task Status:`);
        Object.entries(socialTasks).forEach(([taskId, count]) => {
            console.log(`- Task ${taskId}: ${count} completion${count !== 1 ? 's' : ''}`);
        });

        const missingCount = Object.values(socialTasks).filter(count => count < 1).length;
        if (missingCount > 0) {
            console.log(`\n🔧 Found ${missingCount} missing social tasks`);
            const verified = await verifySocialTasks(address, token, socialTasks);
            console.log(`✅ Successfully verified ${verified}/${missingCount} social tasks`);
        } else {
            console.log('\n🎉 All social tasks already completed');
        }


        // Pharoswap Swaps
        console.log(`\n🔄 Starting ${SWAP_TARGET} Pharoswap swaps...`);
        for (let i = 0; i < SWAP_TARGET; i++) {
            await withRetry(() => performPharoswapSwap(privateKey, address), 3);
            totalSwaps++;
            swapSuccessCount++;
            await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
        }

        // Zenithfi Swaps
        console.log(`\n🔄 Starting ${SWAP_TARGET} Zenithfi swaps...`);
        for (let i = 0; i < SWAP_TARGET; i++) {
            await withRetry(() => performZenithfiSwap(privateKey, address), 3);
            totalSwaps++;
            swapSuccessCount++;
            await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
        }


        console.log(`\n📤 Starting ${SEND_TARGET} sends...`);
        for (let i = 0; i < SEND_TARGET; i++) {
            await withRetry(() => sendToRandomAddress(privateKey, address, token), 3);
            totalSends++;
            sendSuccessCount++;
            await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
        }

        return {
            success: true,
            swaps: swapSuccessCount,
            sends: sendSuccessCount
        };

    } catch (error) {
        console.log(`⚠️ Wallet processing failed: ${error.message}`);
        return {
            success: false,
            swaps: swapSuccessCount,
            sends: sendSuccessCount
        };
    }
}

function printHeader() {
    const line = "=".repeat(50);
    const title = "Auto Daily Checkin, Swap and Send Pharos";
    const createdBy = "Bot created by: https://t.me/airdropwithmeh";

    const totalWidth = 50;
    const titlePadding = Math.floor((totalWidth - title.length) / 2);
    const createdByPadding = Math.floor((totalWidth - createdBy.length) / 2);

    const centeredTitle = title.padStart(titlePadding + title.length).padEnd(totalWidth);
    const centeredCreatedBy = createdBy.padStart(createdByPadding + createdBy.length).padEnd(totalWidth);

    console.log(line);
    console.log(centeredTitle);
    console.log(centeredCreatedBy);
    console.log(line);
}

async function main() {
    printHeader();

    if (!cycleStartTime) {
        cycleStartTime = Date.now();
        console.log(`⏱️ Cycle started at: ${formatTime(cycleStartTime)}`);
    }

    totalSwaps = 0;
    totalSends = 0;
    const privateKeys = readPrivateKeys();

    let successCount = 0;
    totalSwaps = 0;
    for (let i = 0; i < privateKeys.length; i++) {
        const result = await processWallet(privateKeys[i], i, privateKeys.length);
        if (result.success) successCount++;
        totalSwaps += result.swaps;
        if (i < privateKeys.length - 1) await randomDelay();
    }

    console.log(`\n💡 Final Summary:`);
    console.log(`- Processed wallets: ${successCount}/${privateKeys.length}`);
    console.log(`- Total swaps completed: ${totalSwaps}`);
    console.log(`- Total sends completed: ${totalSends}`);
    scheduleNextRun();
}

function scheduleNextRun() {
    const nextRunMs = cycleStartTime + DAILY_RUN_INTERVAL;
    const delayMs = nextRunMs - Date.now();

    console.log(`\n⏰ Next cycle will start at: ${formatTime(nextRunMs)}`);

    cycleStartTime = nextRunMs;

    setTimeout(() => {
        console.log('\n'.repeat(3));
        main();
    }, Math.max(delayMs, 0));
}

process.on('SIGINT', () => {
    console.log(`\n🛑 Process stopped | Next run was scheduled for: ${nextRunTime || 'N/A'}`);
    process.exit();
});

main().catch(error => {
    console.error('🚨 Fatal error:', error);
    process.exit(1);
});
