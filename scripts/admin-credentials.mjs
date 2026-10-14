import { pbkdf2Sync, randomBytes } from 'node:crypto';
// Password arrives via hidden prompt, never command-line args or files.
import { createInterface } from 'node:readline';
const rl=createInterface({input:process.stdin,output:process.stdout,terminal:true});
let hidden=false;
rl._writeToOutput=function(text){if(!hidden)process.stdout.write(text);};
process.stdout.write('Nova senha de admin (mínimo 12 caracteres; entrada oculta): ');
hidden=true;
const password=await new Promise(resolve=>rl.once('line',resolve));
hidden=false;rl.close();process.stdout.write('\n');
if(password.length<12||password.length>128){console.error('Use entre 12 e 128 caracteres.');process.exit(1);}
const salt=randomBytes(16);
console.log('ADMIN_PASSWORD_HASH='+salt.toString('hex')+':'+pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex'));
console.log('ADMIN_SESSION_KEY='+randomBytes(32).toString('hex'));
