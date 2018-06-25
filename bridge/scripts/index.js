/*
index.js
===================
Main index
Get and init constants for bridge
*/

import fs from 'fs';
import keythereum from 'keythereum';

import {
  env,
  constants,
  authority,
} from '../config.json';

import DepositCheckRelay from './deposit_check_relay';
import DepositRelay from './deposit_relay';
import WithdrawConfirm from './withdraw_confirm';
import WithdrawRelay from './withdraw_relay';
import ClaimRelay from './claim_relay';
import ClaimSuccessRelay from './claim_success_relay';

async function startBridge() {
  // private key is held by the user,
  // company will never request any form of keystore or private key from user!
  const password = fs.readFileSync(authority.passwordFile, 'utf8');
  const keyObject = keythereum.importFromFile(authority[env].address, authority.keystoreFolder);
  const privateKey = keythereum.recover(password, keyObject);
  const privateKeyStr = `0x${privateKey.toString('hex')}`;

  const depositCheckRelay = new DepositCheckRelay(privateKeyStr);
  const depositRelay = new DepositRelay(privateKeyStr);
  const withdrawConfirm = new WithdrawConfirm(privateKeyStr);
  const withdrawRelay = new WithdrawRelay(privateKeyStr);
  const claimRelay = new ClaimRelay(privateKeyStr);
  const claimSuccessRelay = new ClaimSuccessRelay(privateKeyStr);
  setInterval(() => {
    depositCheckRelay.update();
    depositRelay.update();
    withdrawConfirm.update();
    withdrawRelay.update();
    claimRelay.update();
    claimSuccessRelay.update();
  }, constants.defaultPollIntervalMs);
}

startBridge();
