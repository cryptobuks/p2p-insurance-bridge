/*
claim_relay.js
===================
Listens to ClaimMade event in Custodian
Triggers MakeClaimPOC in Pool Contract to initiate claim payout
*/

import {
  WAIT_STATE,
  YIELD_STATE,
  RELAY_STATE,
} from './base_states';
import BaseRelay from './base_relay';
import { constants } from '../config.json';

export default class ClaimRelay extends BaseRelay {
  constructor(authPrivateKey) {
    super(authPrivateKey);
    this.relayName = 'Claim Relay';
    this.lastBlock = constants.lastHomeBlock;
  }

  update() {
    switch (this.state) {
      case WAIT_STATE:
        super.updateWaitState(
          RELAY_STATE,
          'home',
          'ClaimMade',
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
            const { policyOwner, claimer } = event.returnValues;
            const promisifiedGasEstimation = () => {
              return new Promise(async (resolve) => {
                try {
                  const gasAmount = await this.foreign.contract.methods
                                    .MakeClaimPOC(policyOwner, claimer)
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
                      data: this.foreign.contract.methods.MakeClaimPOC(
                        event.returnValues.policyOwner,
                        event.returnValues.claimer,
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
          },
        );
        break;
      case YIELD_STATE:
        super.updateYieldState();
        break;
      default: break;
    }
  }
}
