/*
claim_success_relay.js
===================
Listens to ClaimSuccess event in Custodian
Triggers SuccessfulClaimPayout in Pool Contract to update latest pool amount
*/

import {
  WAIT_STATE,
  YIELD_STATE,
  RELAY_STATE,
} from './base_states';
import BaseRelay from './base_relay';
import { constants } from '../config.json';

export default class ClaimSuccessRelay extends BaseRelay {
  constructor(authPrivateKey) {
    super(authPrivateKey);
    this.relayName = 'Claim Success Relay';
    this.lastBlock = constants.lastHomeBlock;
  }

  update() {
    switch (this.state) {
      case WAIT_STATE:
        super.updateWaitState(
          RELAY_STATE,
          'home',
          'ClaimSuccess',
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
          async (event) => {
            const promisifiedGasEstimation = () => {
              return new Promise(async (resolve) => {
                try {
                  const gasAmount = await this.foreign.contract.methods
                                    .SuccessfulClaimPayout(event.returnValues.policyHolder)
                                    .estimateGas({
                                      from: this.authorityAddress,
                                      to: this.foreign.contractAddress,
                                    });
                  if (gasAmount) {
                    resolve({
                      from: this.authorityAddress,
                      to: this.foreign.contractAddress,
                      gas: gasAmount,
                      gas_price: constants.defaultGasPrice,
                      data: this.foreign.contract.methods.SuccessfulClaimPayout(
                        event.returnValues.policyHolder
                      ).encodeABI(),
                    });
                  }
                } catch(e) {
                  this.logErrorWithState(`Dropped event ${event.transactionHash} [Gas estimation failed]`);
                  resolve(null);
                }
              });
            };
            const tx = await promisifiedGasEstimation();
            return tx;
          }
        );
        break;
      case YIELD_STATE:
        super.updateYieldState();
        break;
      default: break;
    }
  }
}
