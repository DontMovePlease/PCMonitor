'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const net = require('net');
function encodePhoneAddress(address) {
  const match = typeof address === 'string' && /^http:\/\/(100\.\d{1,3}\.\d{1,3}\.\d{1,3}):([1-9]\d{0,4})$/.exec(address);
  if (!match || net.isIP(match[1]) !== 4 || Number(match[1].split('.')[1]) < 64 || Number(match[1].split('.')[1]) > 127 || Number(match[2]) > 65535) throw new Error('Invalid phone address.');
  const context = {};
  // Unmodified, pinned upstream encoder. No filesystem/network capabilities
  // are exposed to its context; only the validated URL reaches the encoder.
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../vendor/QRCode/1.8.0/qrcodegen.js'),'utf8'), context, {timeout:1000});
  const qr = context.qrcodegen.QrCode.encodeText(address, context.qrcodegen.QrCode.Ecc.MEDIUM);
  return {size:qr.size,rows:Array.from({length:qr.size},(_,y)=>Array.from({length:qr.size},(_,x)=>qr.getModule(x,y)?'1':'0').join(''))};
}
if (require.main === module) {
  if (process.argv.length !== 2) process.exit(2);
  let input='';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {input+=chunk;if(input.length>1024)process.exit(2);});
  process.stdin.on('end',()=>{try{process.stdout.write(JSON.stringify(encodePhoneAddress(JSON.parse(input))));}catch(_){process.stderr.write('Phone QR is unavailable.');process.exitCode=1;}});
}
module.exports = {encodePhoneAddress};
