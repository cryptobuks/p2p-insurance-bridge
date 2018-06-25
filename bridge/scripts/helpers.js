/*
helpers.js
===================
Helper functions
*/

import zeroFill from 'zero-fill';

// convert datetime to string
const getDateTimeAsString = () => {
  const d = new Date();
  return `[${d.toLocaleDateString()}|${d.toLocaleTimeString()}]`;
};

// zero fill value and convert to hex
const decimalStringToPaddedHexdecimal = value =>
  zeroFill(64, parseInt(value, 10).toString(16));

// remove prefix 0x from string
const removeHexPrefix = (value) => {
  if (value.startsWith('0x')) {
    return value.slice(2);
  }
  return value;
};

// zero fill value
const pad32Byte = value => zeroFill(64, value);


// combine data into byte message
const toByteMessage = (policyHolderAddr, beneficiaryAddr, value, hash) =>
  policyHolderAddr + removeHexPrefix(beneficiaryAddr) +
  decimalStringToPaddedHexdecimal(value) + removeHexPrefix(hash);

export {
  getDateTimeAsString,
  toByteMessage,
};
