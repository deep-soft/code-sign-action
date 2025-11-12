import * as core from '@actions/core';
import { promises as fs } from 'fs';
import path from 'path';
import util from 'util';
import { exec } from 'child_process';
import { env } from 'process';

const asyncExec = util.promisify(exec);
const certificateFileName = env['TEMP'] + '\\certificate.pfx';

// #win2022 const signtool = 'C:/Program Files (x86)/Windows Kits/10/bin/10.0.17763.0/x86/signtool.exe';
// #win2025, next after 10.0.17134.0 is 10.0.26100.0;
// #const signtool = 'C:/Program Files (x86)/Windows Kits/10/bin/10.0.26100.0/x86/signtool.exe';
// or use function getSigntoolLocation
//     const signtool = await getSigntoolLocation()
const signtool = 'C:/Program Files (x86)/Windows Kits/10/bin/10.0.17134.0/x86/signtool.exe';

const signtoolFileExtensions = [
    '.dll', '.exe', '.sys', '.vxd',
    '.msix', '.msixbundle', '.appx',
    '.appxbundle', '.msi', '.msp',
    '.msm', '.cab', '.ps1', '.psm1'
];

function sleep(seconds: number) {
    if (seconds > 0)
        console.log(`Waiting for ${seconds} seconds.`);
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function createCertificatePfx() {
    const base64Certificate = core.getInput('certificate');
    const certificate = Buffer.from(base64Certificate, 'base64');
    if (certificate.length == 0) {
        console.log('The value for "certificate" is not set.');
        return false;
    }
    console.log(`Writing ${certificate.length} bytes to ${certificateFileName}.`);
    await fs.writeFile(certificateFileName, certificate);
    return true;
}

async function addCertificateToStore(){
    try {
        const password: string = core.getInput('password');
        if (password == '') {
            console.log("Password is required to add pfx certificate to store");
            return false;
        }
        const command = `certutil -f -p ${password} -importpfx ${certificateFileName}`
        console.log(`Adding cert to store command: ${command}`);
        const { stdout } = await asyncExec(command);
        console.log(stdout);
        return true;
    } catch (err) {
        console.log(err);
        return false;
    }
}

async function getSigntoolLocation(): Promise<string> {
    const windowsKitsfolder = 'C:/Program Files (x86)/Windows Kits/10/bin/';
    const folders = await fs.readdir(windowsKitsfolder);
    let fileName = 'unable to find signtool.exe';
    let maxVersion = 0;
    for (const folder of folders) {
        if (!folder.endsWith('.0')) {
            continue;
        }
        const folderVersion = parseInt(folder.replace(/\./g,''));
        if (folderVersion > maxVersion) {
            const signtoolFilename = `${windowsKitsfolder}${folder}/x64/signtool.exe`;
            try {
                const stat = await fs.stat(signtoolFilename);
                if (stat.isFile()) {
                    fileName = signtoolFilename
                    maxVersion = folderVersion;
                }
            }
            catch {
            }
        }
    }

    console.log(`Signtool location is ${fileName}.`);

    return fileName;
}

async function signWithSigntool(fileName: string) {
    try {
        // var command = `"${signtool}" sign /as /sm /td sha256 /tr ${timestampUrl} /sha1 "1d7ec06212fdeae92f8d3010ea422ecff2619f5d"  /n "DanaWoo" "${fileName}"`
        let vitalParameterIncluded = false;
        let timestampUrl: string = core.getInput('timestampUrl');
        if (timestampUrl === '') {
          timestampUrl = 'http://timestamp.digicert.com'; // 'http://timestamp.digicert.com';//
        }
        let command = `"${signtool}" sign /as /sm /td sha256 /tr ${timestampUrl}`
        const sha1: string = core.getInput('certificatesha1');
        if (sha1 != '') {
            command = command + ` /sha1 "${sha1}"`
            vitalParameterIncluded = true;
        }
        const name : string = core.getInput('certificatename');
        if (name != '') {
            vitalParameterIncluded = true;
            command = command + ` /n "${name}"`
        }
        if (!vitalParameterIncluded) {
            console.log('You need to include a NAME or a SHA1 Hash for the certificate to sign with.')
        }
        command = `${command} "${fileName}"`;
        console.log(`Signing command: ${command}`);
        const { stdout } = await asyncExec(command);
        console.log(stdout);
        return true;
    } catch(err) {
        console.log(err);
        return false;
    }
}

async function trySignFile(fileName: string) {
    console.log(`Signing ${fileName}.`);
    const extension = path.extname(fileName);
    for (let i = 0; i < 3; i++) {
        await sleep(i);
        if (signtoolFileExtensions.includes(extension)) {
            if (await signWithSigntool(fileName)) {
                return;
            }
        }
    }

    throw `Failed to sign '${fileName}'.`;
}

async function* getFiles(folder: string, recursive: boolean): any {
    const files = await fs.readdir(folder);
    for (const file of files) {
        const fullPath = `${folder}/${file}`;
        const stat = await fs.stat(fullPath);
        if (stat.isFile()) {
            const extension = path.extname(file);
            // if (signtoolFileExtensions.includes(extension) || extension == '.nupkg') {
            if (signtoolFileExtensions.includes(extension)) {
                yield fullPath;
            }
        } else if (stat.isDirectory() && recursive) {
            yield* getFiles(fullPath, recursive);
        }
    }
}

async function signFiles() {
    const folder = core.getInput('folder', { required: true });
    const recursive = core.getInput('recursive') == 'true';
    for await (const file of getFiles(folder, recursive)) {
        await trySignFile(file);
    }
}

async function run() {
    try {
        if (await createCertificatePfx())
        {
            if (await addCertificateToStore())
                await signFiles();
        }
    } catch (err) {
        core.setFailed(`Action failed with error: ${err}`);
    }
}

run();
