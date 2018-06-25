# PolicyPal Network P2P Insurance POC

**Disclaimer:** This code is not ready for Production. We are still constantly improving on the code as it undergoes various tests for security, edge cases, and bugs.

## Description
The bridge is a modified version of [Parity Bridge](https://github.com/paritytech/parity-bridge), re-written from RUST to Javascript and modified for the POC's requirements. 
Bridges are communication layers between a Main and Private Net, constantly "listening" for events happening within the two chains. They are also authorities which can validate transactions and access data between the two chains.

When a payment or claims transaction is made, all bridges will pick up the event and check its validity with the Private Net’s record. Valid transactions will be signed by the bridge authorities and recorded in the Smart Contract.

Only when a required signature count is met, the transaction data will be synced between the two chains, triggering the policy or the claim payout. In our current Proof-of-Concept, Private Net is running on Proof of Authority (PoA) to increase information privacy, lower transaction fees and faster block times. At the moment, 2 signatures are required for claim payout approval with 3 running authority bridges.

This concept can be applied directly to power our P2P insurance. We are developing a generalised version of our bridge to extend to blockchains other than Ethereum. This enables inter-chain communication between PolicyPal Network and other chains for partnerships and non-PAL payouts.

Users pay only the cost (gas fee) for policy payments and claiming. Authorities will bare all other required fees.

### Signing of Transactions
![alt Claim Approval with Authorities](https://cdn-images-1.medium.com/max/1400/1*Q0Xe1gO7A1xOSLDh_VRMiw.png)

**Path 1 (Green)**
* After the user has made a claim, all authority bridges pick up the event and validate the claim made by the user.
* If the claim is valid, each authority will consolidate the claim’s information and sign the data with its private key.
* Signatures are tied to the hashed data of the claim information. Modifying any information — such as the beneficiary’s address or the payout amount — will invalidate the signature.
* The claim will not be processed until a given number of signatures is collected e.g. the claim will be processed as long as 2/3 authorities has submitted a valid signature. (Byzantine Fault Tolerant)

**Path 2 (Red)**
* Upon receiving the required number for signatures, the contract triggers a signature collected event.
* The last authority that signs the transaction is responsible for processing the claim. It gathers all signatures and submits the claim request to the Main Net contract.
* The contract verifies that all signatures are valid and signed by authorities. Failure to validate any signature will revert the claim process.
* A successful verification triggers the claim payout to the user and records the transaction in Main Net.

**Path 3 (Purple)**
* Authorities pick up the successful claim payout event and inform Private Net.
* Contract deducts the payout amount from the pool and updates the user’s policy.


## Code
The script uses a variety of open source projects.
* [Web3JS] - Ethereum Compatible Javascript API.
* [Lodash] - Utility Framework.
* [Zeppelin] - Token based contracts.

**Contracts**
* [Custodian.sol] - Smart contract for main net to initiate and verify transactions. Store authority addresses.
* [PoolContract.sol] - Smart contract for private net to initiate and verify payouts. Stores information of authorities, pool, policy and claim. 

**Main Scripts**
* [deposit_check_relay.js] - Verifies payment and initiate transfer from user wallet to contract. 
* [deposit_relay.js] - Confirms payment, update private net and incept policy.
* [claim_relay.js] - Sends a claim request to private net.
* [withdraw_confirm.js] - Generate and submit a signature using payout data.
* [withdraw_relay.js] - Collect signatures and sends to contract verification. Initate payout if verified.
* [claim_success_relay.js] - Inform and update private net of a successful payout.

**Note:** Due to the sensitive nature of business logic(s), Code for Private Net and PoolContract.sol is not included in this version.

## Setup
* Add keystore to folder `input/keystore`.
* Add poolcontract.abi.json and tokencontract.abi.json to folder `input`.
* Update host api and contract addresses in `config.json`.

## Installation
#### Libraries & Dependencies
To install libraries & dependencies,
```
$ npm install
```

## Execution
To start execution, 
```
npm start
```
and it will begin listening for events from the *token contracts*.

## Common Issues
* `Error: Invalid JSON RPC response: ""`: Private net might not be running/Duplicate transactions done.
* `Returned error: replacement transaction underpriced`: Tried to overwrite pending transactions as the script is unable to get the correct nonce if there are pending transactions.

## Improvements/To-do
* Signing for deposit events.