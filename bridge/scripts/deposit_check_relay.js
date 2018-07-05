/*
deposit_check_relay.js
===================
Listens to token Approval event for Custodian
Triggers CheckTransaction in Pool Contract to verify payment
Triggers MakeTransaction in Custodian to initiate transfer from user wallet to contract
*/

import _ from 'lodash';

import {
  WAIT_STATE,
  RELAY_STATE,
  YIELD_STATE,
} from './base_states';
import BaseRelay from './base_relay';
import { constants } from '../config.json';

const CHECK_STATE = 'CHECK_STATE';

export default class DepositCheckRelay extends BaseRelay {
  constructor(authPrivateKey) {
    super(authPrivateKey);
    this.relayName = 'Deposit Check Relay';
    this.lastBlock = constants.lastHomeBlock;
  }

  update() {
    switch (this.state) {
      case WAIT_STATE:
        super.updateWaitState(
          CHECK_STATE,
          'token',
          'Approval',
          {
            fromBlock: this.lastBlock,
            toBlock: 'latest',
            filter: {
              spender: this.home.contractAddress,
            },
          },
        );
        break;
      case CHECK_STATE:
        this.updateCheckState();
        break;
      case RELAY_STATE:
        super.updateRelayState(
          WAIT_STATE,
          'home',
          async (event) => {
            const { owner } = event.returnValues;
            const checkResult = this.lastCheckedResults[owner];
            if (checkResult && checkResult.expectedAmount > 0) {
              const {
                expectedAmount,
                rebateAmount
              } = checkResult;
              const promisifiedGasEstimation = () => {
                return new Promise(async (resolve) => {
                  try {
                    const gasAmount = await this.home.contract.methods
                                      .MakeTransaction(
                                        owner,
                                        expectedAmount,
                                        rebateAmount,
                                      )
                                      .estimateGas({
                                        from: this.authorityAddress,
                                        to: this.home.contractAddress,
                                      });
                    if (gasAmount) {
                      resolve({
                        from: this.authorityAddress,
                        to: this.home.contractAddress,
                        gas: constants.defaultGas, // 4,000,000
                        gasPrice: constants.defaultGasPrice * 10, // 1 gwei
                        data: this.home.contract.methods.MakeTransaction(
                          owner,
                          expectedAmount,
                          rebateAmount,
                        ).encodeABI(),
                      });
                    }
                  } catch(e) {
                    this.logErrorWithState(`Dropped event ${event.transactionHash} [Gas estimation failed]`);
                    resolve(null);
                  }
                });
              }
              const tx = await promisifiedGasEstimation();
              return tx;
            }
            this.logWithState(`Check failed: ${event.transactionHash}. Rejecting!`);
            return null;
          },
        );
        break;
      case YIELD_STATE:
        super.updateYieldState();
        break;
      default: break;
    }
  }

  async updateCheckState() {
    // clear last results
    this.lastCheckedResults = {};

    const eventsToBeProcessed = _.take(this.unprocessedEventsQueue, constants.cappedTxsPerBlock);
    const checkTxs = _.map(
      eventsToBeProcessed,
      event => new Promise((resolve) => {
        const ownerAddress = event.returnValues.owner;
        this.foreign.contract.methods.CheckTransaction(ownerAddress)
          .call({ from: this.authorityAddress })
          .then(checkResult => resolve({
            ownerAddress,
            result: checkResult,
          }));
      }),
    );

    Promise.all(checkTxs)
      .then((checkResults) => {
        _.forEach(
          checkResults,
          checkResult => this.lastCheckedResults[checkResult.ownerAddress] = checkResult.result,
        );
        this.changeState(RELAY_STATE);
      });
  }

  /* async updateRelayDepositToHome() {
    if (this.unprocessedEventsQueue.length > 0) {
      const eventsToBeProcessed = this.unprocessedEventsQueue.splice(
        0,
        constants.cappedTxsPerBlock,
      );
      this.logWithState(`Processing ${eventsToBeProcessed.length} events...`);
      this.logWithState(`Unprocessed ${this.unprocessedEventsQueue.length} left...`);
      const checkTxPromises = _.map(
        eventsToBeProcessed,
        event =>
          this.foreign.contract.methods.CheckTransaction(event.returnValues.owner)
            .call({ from: this.authorityAddress }),
      );

      const checkTxResults = await Promise.all(checkTxPromises);
      const relayToHomeTxPromises = _.map(
        checkTxResults,
        (checkResult, idx) => {
          if (checkResult.expectedAmount > 0) {
            return new Promise(async (resolve) => {
              const payload = {};
              const txObj = {
                from: this.authorityAddress,
                to: this.home.contractAddress,
                gas: constants.defaultGas, // 4,000,000
                gasPrice: constants.defaultGasPrice * 10, // 1 gwei
                data: this.home.contract.methods.MakeTransaction(
                  eventsToBeProcessed[idx].returnValues.owner,
                  checkResult.expectedAmount,
                  checkResult.rebateAmount,
                ).encodeABI(),
              };

              const signedTx = await this.web3.home.eth.accounts.signTransaction(
                txObj,
                this.authorityPrivateKey,
              );
              this.web3.home.eth.sendSignedTransaction(signedTx.rawTransaction)
                .then(txRes => payload.result = txRes)
                .catch(error => payload.error = {
                  errorMsg: error,
                  eventObj: eventsToBeProcessed[idx],
                })
                .then(() => resolve(payload));
            });
          }
          return null;
        },
      );

      Promise.all(relayToHomeTxPromises)
        .then((resultPayloads) => {
          let failCounter = 0;
          this.logWithState('----------------- Relay to Home Batch Result -----------------');
          _.forEach(resultPayloads, (resultPayload) => {
            if (resultPayload.error) {
              const { eventObj } = resultPayload.error;
              const {
                transactionHash,
                blockNumber,
              } = eventObj;

              if (!this.failedEvents[transactionHash]) {
                this.failedEvents[transactionHash] = { eventObj, failedCount: 0 };
              }

              this.failedEvents[transactionHash].failedCount += 1;
              // only retry once
              if (this.failedEvents[transactionHash].failedCount < 1) {
                this.unprocessedEventsQueue.unshift(eventObj);
              }

              this.logErrorWithState(`❌ Event Tx Hash: ${transactionHash} (${blockNumber})`);
              // this.logErrorWithState(errorMsg);
              failCounter += 1;
            } else {
              this.logWithState(`✅ Tx Hash: ${resultPayload.result.transactionHash}`);
            }
          });
          this.logWithState(`Total Tx(s): ${resultPayloads.length} (Failed: ${failCounter})`);
          this.logWithState('--------------------------------------');
          // Done processing all relay to home promises back to wait state
          this.changeState(DepositCheckRelayState.WAIT_STATE);
        })
        .catch((error) => {
          this.logErrorWithState(`⛔️ Relay to Home Promises Failed: ${error} ⛔️`);
          this.logWithState('--------------------------------------');
          this.changeState(DepositCheckRelayState.WAIT_STATE);
        });

      // As Tx(s) don't get mined fast, we put the statemachine in a yield state
      // so as to not jam up the whole program execution
      this.changeState(DepositCheckRelayState.YIELD_STATE);
    }
  } */

  /* updateRelayDepositToHomeOG() {
    if (!this.isAwaitingRequest && this.pendingTxRequests.length > 0) {
      // const signingTxs = [];
      // const requests = [];

      // this.logWithState(`Received ${this.pendingTxRequests.length} transactions to sign`);
      // _.forEach(
      //   this.pendingTxRequests,
      //   (txRequest) => {
      //     // 0x3Cd0431fbf040Bfe2C0172140bC707D127beb65D PK
      //     signingTxs.push(this.web3.home.eth.accounts.signTransaction(txRequest, HOME_PRIVATE_KEY)); // https://github.com/ethereum/web3.js/issues/1094
      //   },
      // );
      // this.logWithState(`Signing ${signingTxs.length} transactions...`);

      // Promise.all(signingTxs)
      //   .then((signedTxs) => {
      //     _.forEach(signedTxs, (signedTx) => {
      //       requests.push(this.web3.home.eth.sendSignedTransaction(signedTx.rawTransaction));
      //     });

      //     Promise.all(requests)
      //       .then((results) => {
      //         // console.log(`updateRelayDepositToHome results: ${results}`);
      //         // console.log(results);

      //         this.changeState(DepositCheckRelayState.WAIT_STATE);
      //         this.isAwaitingRequest = false;

      //         this.pendingTxRequests = [];
      //       })
      //       .catch((error) => {
      //         this.logErrorWithState(`Error with Promise.all... ${error}`);
      //         this.changeState(DepositCheckRelayState.WAIT_STATE);
      //         this.isAwaitingRequest = false;
      //       });
      //   });

      // use this if account is unlocked
      const requests = [];
      _.forEach(
        this.pendingTxRequests,
        txRequest => requests.push(this.web3.home.eth.sendTransaction(txRequest)),
      );
      this.logWithState(`Submitting ${this.pendingTxRequests.length} transactions...`);

      Promise.all(requests)
        .then((results) => {
          this.logWithState(`${results.length} transactions submitted! (Total: ${this.totalTxRequestSubmitted})`);
          this.logWithState('---------------------------- TX Hashes -----------------------------');
          _.forEach(results, (r, idx) => this.logWithState(`${idx + 1}: ${r.transactionHash}`));
          this.logWithState('--------------------------------------------------------------------');

          this.changeState(DepositCheckRelayState.WAIT_STATE);
          this.isAwaitingRequest = false;

          this.pendingTxRequests = [];
        })
        .catch((error) => {
          this.logErrorWithState(`Error with Promise.all... ${error}`);
          this.pendingTxRequests = [];
          this.changeState(DepositCheckRelayState.WAIT_STATE);
          this.isAwaitingRequest = false;
        });

      this.isAwaitingRequest = true;
      this.changeState(DepositCheckRelayState.YIELD_STATE);
    }
  } */
}
