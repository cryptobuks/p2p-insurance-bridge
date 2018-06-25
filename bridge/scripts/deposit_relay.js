/*
deposit_relay.js
===================
listens to Transfer event from Token to Custodian
triggers MakeTransaction in Pool Contract for policy inception
*/

import {
  WAIT_STATE,
  YIELD_STATE,
  RELAY_STATE,
} from './base_states';
import BaseRelay from './base_relay';
import { constants } from '../config.json';

export default class DepositRelay extends BaseRelay {
  constructor(_authPrivateKey) {
    super(_authPrivateKey);
    this.relayName = 'Deposit Relay';
    this.lastBlock = constants.lastHomeBlock;
  }

  update() {
    switch (this.state) {
      case WAIT_STATE:
        super.updateWaitState(
          RELAY_STATE,
          'token',
          'Transfer',
          {
            fromBlock: this.lastBlock,
            toBlock: 'latest',
            filter: {
              to: this.home.contractAddress,
            },
          },
        );
        break;
      case RELAY_STATE:
        super.updateRelayState(
          WAIT_STATE,
          'foreign',
          event => ({
            from: this.authorityAddress,
            to: this.foreign.contractAddress,
            gas: constants.defaultGas,
            gas_price: constants.defaultGasPrice,
            data: this.foreign.contract.methods.MakeTransaction(
              event.returnValues.from,
              this.authorityAddress,
              event.returnValues.value,
            ).encodeABI(),
          }),
        );
        break;
      case YIELD_STATE:
        super.updateYieldState();
        break;
      default: break;
    }
  }
}
