/*
deposit_check_relay.js
===================
listens to Approval event for Custodian
triggers CheckTransaction in Pool Contract for address verification
triggers MakeTransaction in Custodian to initiate transfer
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
          (event) => {
            const { owner } = event.returnValues;
            const checkResult = this.lastCheckedResults[owner];
            if (checkResult && checkResult.expectedAmount > 0) {
              return {
                from: this.authorityAddress,
                to: this.home.contractAddress,
                gas: constants.defaultGas,
                gasPrice: constants.defaultGasPrice * 10,
                data: this.home.contract.methods.MakeTransaction(
                  owner,
                  checkResult.expectedAmount,
                  checkResult.rebateAmount,
                ).encodeABI(),
              };
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

    // check payment validity with private net
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
}
