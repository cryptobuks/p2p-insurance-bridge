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
  level,
} from '../config/config.json';

import DepositCheckRelay from './deposit_check_relay';
import DepositRelay from './deposit_relay';
import WithdrawConfirm from './withdraw_confirm';
import WithdrawRelay from './withdraw_relay';
import ClaimRelay from './claim_relay';
import ClaimSuccessRelay from './claim_success_relay';

async function startBridge() {
  const password = fs.readFileSync(authority.passwordFile, 'utf8');
  console.log('Importing keystore');
  const keyObject = keythereum.importFromFile(authority[env].address, authority.keystoreFolder);
  console.log('Getting privatekey');
  const privateKey = keythereum.recover(password, keyObject);
  const privateKeyStr = `0x${privateKey.toString('hex')}`;

  console.log('Setting up relays');
  const depositCheckRelay = new DepositCheckRelay(privateKeyStr);
  const depositRelay = new DepositRelay(privateKeyStr);
  const withdrawConfirm = new WithdrawConfirm(privateKeyStr);
  const withdrawRelay = new WithdrawRelay(privateKeyStr);
  const claimRelay = new ClaimRelay(privateKeyStr);
  const claimSuccessRelay = new ClaimSuccessRelay(privateKeyStr);

  setInterval(() => {
    if (level == "master") {
      depositCheckRelay.update(); // disable for normal auth
      depositRelay.update(); // disable for normal auth
      claimRelay.update(); // disable for normal auth
      claimSuccessRelay.update(); // disable for normal auth
    }
    
    withdrawConfirm.update();
    withdrawRelay.update();
    
  }, constants.defaultPollIntervalMs);
}

startBridge();
