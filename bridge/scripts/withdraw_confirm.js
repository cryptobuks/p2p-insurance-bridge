/*
withdraw_confirm.js
===================
listens to ClaimApproved event in Pool Contract
create byte message and sign it with private key
triggers submitSignature in Pool Contract to approve transaction
*/

import {
  WAIT_STATE,
  YIELD_STATE,
  RELAY_STATE,
} from './base_states';
import BaseRelay from './base_relay';
import { constants } from '../config.json';
import { toByteMessage } from './helpers';

export default class WithdrawConfirm extends BaseRelay {
  constructor(_token, _homeStuffs, _foreignStuffs) {
    super(_token, _homeStuffs, _foreignStuffs);
    this.relayName = 'Withdraw Confirm';
    this.lastBlock = constants.lastForeignBlock;
    this.pendingTxRequests = [];
  }

  update() {
    switch (this.state) {
      case WAIT_STATE:
        super.updateWaitState(
          RELAY_STATE,
          'foreign',
          'ClaimApproved',
          {
            fromBlock: this.lastBlock,
            toBlock: 'latest',
            filter: {
              to: this.foreign.contractAddress,
            },
          },
        );
        break;
      case RELAY_STATE:
        super.updateRelayState(
          WAIT_STATE,
          'foreign',
          (event) => {
            const {
              returnValues: {
                _policyAddr,
                _beneficiaryAddr,
                _payoutAmount,
              },
              transactionHash,
            } = event;

            // construct message
            const message = toByteMessage(
              _policyAddr,
              _beneficiaryAddr,
              _payoutAmount,
              transactionHash,
            );

            // generate signature with message and key
            const signResult = this.web3.foreign.eth.accounts.sign(
              message,
              this.authorityPrivateKey,
            );
            return {
              from: this.authorityAddress,
              to: this.foreign.contractAddress,
              gas: constants.defaultGas,
              gas_price: constants.defaultGasPrice,
              data: this.foreign.contract.methods.submitSignature(
                signResult.signature,
                signResult.message,
              ).encodeABI(),
            };
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
