import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(scriptDirectory, "../backups/updater");
const privateKeyPath = resolve(outputDirectory, "aster-update-private.pem");
const publicKeyPath = resolve(outputDirectory, "aster-update-public.key");

mkdirSync(outputDirectory, { recursive: true });

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
const publicDer = publicKey.export({ type: "spki", format: "der" });
const rawPublicKey = publicDer.subarray(publicDer.length - 32);

writeFileSync(privateKeyPath, privatePem, { mode: 0o600 });
writeFileSync(publicKeyPath, `${rawPublicKey.toString("base64")}\n`);

console.log(`Private key: ${privateKeyPath}`);
console.log(`Public key:  ${publicKeyPath}`);
