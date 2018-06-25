/*
base_relay.js
===================
Relay Functions and logs
*/

import Web3 from 'web3';
import fs from 'fs';
import _ from 'lodash';

import {
  env,
  constants,
  authority,
  network,
  token,
  custodian,
  pool,
} from '../config.json';
import {
  WAIT_STATE,
  YIELD_STATE,
} from './base_states';
import { getDateTimeAsString } from './helpers';

export default class BaseRelay {
  constructor(_authPrivateKey) {
    this.web3 = {
      home: new Web3(network[env].home),
      foreign: new Web3(network[env].foreign),
    };

    this.token = {
      contractAddress: token[env].address,
      contract: new this.web3.home.eth.Contract(
        JSON.parse(fs.readFileSync(token.abi)),
        token[env].address,
      ),
    };

    this.home = {
      contractAddress: custodian[env].address,
      contract: new this.web3.home.eth.Contract(
        JSON.parse(fs.readFileSync(custodian.abi)),
        custodian[env].address,
      ),
    };

    this.foreign = {
      contractAddress: pool[env].address,
      contract: new this.web3.foreign.eth.Contract(
        JSON.parse(fs.readFileSync(pool.abi)),
        pool[env].address,
      ),
    };

    this.authorityAddress = authority[env].address;
    this.authorityPrivateKey = _authPrivateKey;

    this.relayName = 'Base Relay';
    this.state = WAIT_STATE;
    this.lastBlock = 0;
    this.unprocessedEventsQueue = [];
    this.failedEvents = {};
    this.successfulEvents = {};

    this.lastConsoleOutput = null;
  }

  signAndSendTransactionPromise(dest, tx, event) {
    if (tx) {
      return new Promise(async (resolve) => {
        const payload = {};
        const signedTx = await this.web3[dest].eth.accounts.signTransaction(
          tx,
          this.authorityPrivateKey,
        );

        this.web3[dest].eth.sendSignedTransaction(signedTx.rawTransaction)
          .then(txRes => payload.result = txRes)
          .catch(error => payload.error = error)
          .then(() => resolve(Object.assign(payload, { eventObj: event })));
      });
    }
    return null;
  }

  async updateWaitState(
    nextState,
    eventFromContract,
    eventName,
    eventOptions,
  ) {
    this.logWithState(`Waiting for ${eventName} events from Block ${this.lastBlock}... (In Queue: ${this.unprocessedEventsQueue.length})`);
    // listen for transfer events
    try {
      const events = await this[eventFromContract].contract.getPastEvents(
        eventName,
        eventOptions,
      );
      if (events && events.length > 0) {
        this.logWithState(`Num events received ${events.length} from Home since block ${this.lastBlock}`);
        // add new events to unprocessed queue
        this.unprocessedEventsQueue = this.unprocessedEventsQueue.concat(events);
        // get the "latest" block number for unprocessed events
        _.forEach(this.unprocessedEventsQueue, (event) => {
          this.lastBlock = Math.max(this.lastBlock, event.blockNumber + 1);
        });

        this.changeState(nextState);
      } else if (this.unprocessedEventsQueue.length > 0) {
        this.changeState(nextState);
      }
    } catch (e) {
      this.logErrorWithState(`⛔️ Error (from Block ${this.lastBlock})- ${e} ⛔️`);
    }
  }

  updateRelayState(
    nextState,
    dest,
    relayTxCreatorFunc,
  ) {
    if (this.unprocessedEventsQueue.length > 0) {
      const eventsToBeProcessed = this.unprocessedEventsQueue.splice(
        0,
        constants.cappedTxsPerBlock,
      );
      this.logWithState(`Processing ${eventsToBeProcessed.length} events...`);
      this.logWithState(`Unprocessed ${this.unprocessedEventsQueue.length} left...`);

      const relayTxs = _.compact(_.map(
        eventsToBeProcessed,
        (event, idx) => this.signAndSendTransactionPromise(
          dest,
          relayTxCreatorFunc(event),
          eventsToBeProcessed[idx],
        ),
      ));

      if (relayTxs && relayTxs.length > 0) {
        Promise.all(relayTxs)
          .then((resultPayloads) => {
            let failCounter = 0;
            this.logWithState('----------------- Relay Batch Result -----------------');
            _.forEach(resultPayloads, (resultPayload) => {
              if (resultPayload.error) {
                const { eventObj, error } = resultPayload;
                const {
                  transactionHash,
                  blockNumber,
                } = eventObj;

                if (!this.failedEvents[transactionHash]) {
                  this.failedEvents[transactionHash] = { eventObj, failedCount: 0 };
                }

                this.failedEvents[transactionHash].failedCount += 1;
                // only retry once
                if (this.failedEvents[transactionHash].failedCount < 1 /* 2 */) {
                  this.unprocessedEventsQueue.unshift(eventObj);
                }

                this.logErrorWithState(`❌ Event Tx Hash: ${transactionHash} (${blockNumber})`);
                this.logErrorWithState(error);
                failCounter += 1;
              } else {
                this.logWithState(`✅ Tx Hash: ${resultPayload.result.transactionHash}`);
              }
            });
            this.logWithState(`Total Tx(s): ${resultPayloads.length} (Failed: ${failCounter})`);
            this.logWithState('--------------------------------------');
            // Done processing all relay to home promises back to wait state
            this.changeState(nextState);
          })
          .catch((error) => {
            this.logErrorWithState(`⛔️ Relay to ${dest} Promises Failed: ${error} ⛔️`);
            this.logWithState('--------------------------------------');
            this.changeState(WAIT_STATE);
          });

        // As Tx(s) don't get mined fast, we put the statemachine in a yield state
        // so as to not jam up the whole program execution
        this.changeState(YIELD_STATE);
      } else {
        this.changeState(WAIT_STATE);
      }
    }
  }

  updateYieldState() {
    this.logWithState('Yielding... ⏳');
  }

  logWithState(s) {
    const currMsg = `${this.relayName} - [${this.state.toUpperCase()}] >> ${s}`;
    if (currMsg !== this.lastConsoleOutput) {
      console.log(`${getDateTimeAsString()} ${currMsg}`);
    }
    this.lastConsoleOutput = currMsg;
  }

  logErrorWithState(s) {
    const currMsg = `${this.relayName} - [${this.state.toUpperCase()}] >> ${s}`;
    if (currMsg !== this.lastConsoleOutput) {
      console.error(`${getDateTimeAsString()} ${currMsg}`);
    }
    this.lastConsoleOutput = currMsg;
  }

  changeState(newState) {
    console.log(`${getDateTimeAsString()} ${this.relayName} - 🔃 Changing from state ${this.state} to ${newState}`);
    this.state = newState;
  }

  update() {
    // intentionally left empty
  }
}
