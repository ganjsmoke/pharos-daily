
# Pharos Auto Daily Bot

## Overview
Register : https://testnet.pharosnetwork.xyz/experience?inviteCode=igTbAn078cxwfif2

This bot is designed to automate daily interactions with the Pharos network. It performs tasks such as:
- User login using private keys
- Check-in process
- Swap and send tasks to complete necessary actions for the user
- Verifies social tasks (e.g., social interactions or activities) and ensures compliance (CONNECT YOUR TWITTER -> FOLLOW PHAROS AND JOIN PHAROS DISCORD)

## Features

- **Automatic Login**: Logs into the Pharos network using the private keys provided in a text file.
- **Task Completion**: Completes specific tasks including swaps and sends for network interaction.
- **Social Task Verification**: Verifies missing social tasks (ID: 201, 202, 203, 204) and performs them automatically if required.
- **Scheduled Runs**: The bot runs automatically every 8 hours, ensuring that all necessary tasks are completed and the system is updated.
- **Swap and Send Functionality**: Handles swaps between PHRS  and stablecoins (USDT, USDC) and sends small amounts of PHRS to random addresses to meet the requirements.
- **Error Handling**: Retries operations in case of failure up to a configurable maximum number of retries.
- **Progress Reporting**: Displays task progress with detailed feedback about completed swaps and sends.

## Setup

### Prerequisites

- **Node.js** (v16 or higher) must be installed.
- **npm** (Node package manager) to manage dependencies.

### Installation Steps

1. Clone the repository:

```bash
git clone https://github.com/ganjsmoke/pharos-daily.git
cd pharos-daily
```

2. Install the required dependencies:

```bash
npm install web3@1.8.0 axios
```

3. Create a `private_keys.txt` file in the project root directory. This file should contain the private keys of the wallets you want the bot to use (one per line).

4. Run the bot using the following command:

```bash
node index.js
```

The bot will automatically start running and complete the daily tasks.

## Features Walkthrough

### Login

- The bot reads the private keys from `private_keys.txt` and uses them to sign a request to log into the Pharos network.
- Once logged in, the bot retrieves a JWT token which is used for further actions.

### Task Status and Check-In

- It checks the status of the user on the network and performs a check-in if required.
- If the user hasn't completed all social tasks, the bot will attempt to complete them (Tasks 201-204).

### Swap and Send Transactions

- The bot performs swaps between PHRS and stablecoins (USDT, USDC) automatically.
- It also sends small amounts of PHRS to random addresses to complete the send tasks.

### Retry Mechanism

- The bot ensures all actions have a retry mechanism in place in case of failures.
- It retries failed actions a set number of times with exponential backoff.

### Scheduled Runs

- The bot runs every **8 hours**. You can configure this interval as per your requirement.



## License

This project is licensed under the MIT License
