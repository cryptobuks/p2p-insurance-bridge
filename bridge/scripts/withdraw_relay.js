/*
withdraw_relay.js 
===================
Listens to CollectedSignatures event in Pool Contract
Assigned authoirty recevies collected signatures and submit all to Custodian with ClaimPayout
Custodian verifies signatures and initate claim payout 
*/

import _ from 'lodash';
import {
  WAIT_STATE,
  RELAY_STATE,
  YIELD_STATE,
} from './base_states';
import BaseRelay from './base_relay';
import { constants } from '../config.json';

const CHECKANDSIGN_STATE = 'CHECKANDSIGN_STATE';

export default class WithdrawRelay extends BaseRelay {
  constructor(authPrivateKey) {
    super(authPrivateKey);
    this.relayName = 'Withdraw Relay';
    this.lastBlock = constants.lastForeignBlock;
  }

  update() {
    switch (this.state) {
      case WAIT_STATE:
        super.updateWaitState(
          CHECKANDSIGN_STATE,
          'foreign',
          'CollectedSignatures',
          {
            fromBlock: this.lastBlock,
            toBlock: 'latest',
            filter: {
              to: this.foreign.contractAddress,
            },
          },
        );
        break;
      case CHECKANDSIGN_STATE:
        this.updateCheckAndSignState();
        break;
      case RELAY_STATE:
        super.updateRelayState(
          WAIT_STATE,
          'home',
          (event) => {
            const { transactionHash } = event;
            const signResult = this.lastCheckAndSignedResults[transactionHash];

            if (signResult.responsible) {
              return {
                from: this.authorityAddress,
                to: this.home.contractAddress,
                gas: constants.defaultGas,
                gasPrice: constants.defaultGasPrice * 10,
                data: this.home.contract.methods.ClaimPayout(
                  signResult.vs,
                  signResult.rs,
                  signResult.ss,
                  signResult.message,
                ).encodeABI(),
              };
            }
            
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

  async updateCheckAndSignState() {
    this.lastCheckAndSignedResults = {};

    const eventsToBeProcessed = _.take(this.unprocessedEventsQueue, constants.cappedTxsPerBlock);
    const checkSignTxs = _.map(
      eventsToBeProcessed,
      event => new Promise(async (resolve) => {
        const { returnValues, transactionHash } = event;
        if (returnValues) {
          const {
            authorityResponsibleForRelay,
            messageHash,
          } = returnValues;

          // ignore and resolve if not responsible for relay
          if (authorityResponsibleForRelay.toLowerCase() !== this.authorityAddress.toLowerCase()) {
            this.logWithState('Not responsible for relay, ignoring');
            resolve({
              responsible: false,
              transactionHash,
            });
            return null;
          }

          // get requiredSignatures dynamically
          const requiredSignatures = await this.foreign.contract.methods.requiredSignatures().call();

          // collect message and all signatures
          this.logWithState('Responsible for relay, proceeding');
          const message = await this.foreign.contract.methods.message(messageHash).call();
          const sigRequests = [];
          for (let i = 0; i < requiredSignatures; i++) {
            sigRequests.push(this.foreign.contract.methods.signature(messageHash, i).call());
          }

          Promise.all(sigRequests)
            .then((resultSigs) => {

              const rs = [];
              const ss = [];
              const vs = [];

              // convert signatures to r, s, v
              _.forEach(resultSigs, (signature) => {

                const r = signature.slice(0, 66);
                const s = `0x${signature.slice(66, 130)}`;
                let v = `0x${signature.slice(130, 132)}`;
                v = this.web3.home.utils.hexToNumber(v);
                if (v !== 27 && v !== 28) v += 27;

                rs.push(r);
                ss.push(s);
                vs.push(v);
              });

              resolve({
                transactionHash,
                rs,
                ss,
                vs,
                message,
                responsible: true,
              });
            });
        }
        return null;
      }),
    );

    Promise.all(checkSignTxs)
      .then((results) => {
        _.forEach(
          results,
          result => this.lastCheckAndSignedResults[result.transactionHash] = result,
        );
        this.changeState(RELAY_STATE);
      });
  }
}