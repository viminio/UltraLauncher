const AdmZip        = require('adm-zip')
const async         = require('async')
const child_process = require('child_process')
const crypto        = require('crypto')
const EventEmitter  = require('events')
const fs            = require('fs-extra')
const StreamZip     = require('node-stream-zip')
const path          = require('path')
const Registry      = require('winreg')
const request       = require('request')
const tar           = require('tar-fs')
const zlib          = require('zlib')
const ConfigManager = require('./configmanager')
const DistroManager = require('./distromanager')
const isDev         = require('./isdev')

class Asset {
    /**
     * @param {any} id
     * @param {string} hash
     * @param {number} size
     * @param {string} from
     * @param {string} to
     **/
    constructor(id, hash, size, from, to){
        this.id = id
        this.hash = hash
        this.size = size
        this.from = from
        this.to = to
    }
}

class Library extends Asset {

    static mojangFriendlyOS(){
        const opSys = process.platform
        if (opSys === 'darwin') {
            return 'osx'
        } else if (opSys === 'win32'){
            return 'windows'
        } else if (opSys === 'linux'){
            return 'linux'
        } else {
            return 'unknown_os'
        }
    }

    /**
     * @param {Array.<Object>} rules
     * @param {Object} natives
     * @returns {boolean}
     **/
    static validateRules(rules, natives){
        if(rules == null) {
            if(natives == null) {
                return true
            } else {
                return natives[Library.mojangFriendlyOS()] != null
            }
        }

        for(let rule of rules){
            const action = rule.action
            const osProp = rule.os
            if(action != null && osProp != null){
                const osName = osProp.name
                const osMoj = Library.mojangFriendlyOS()
                if(action === 'allow'){
                    return osName === osMoj
                } else if(action === 'disallow'){
                    return osName !== osMoj
                }
            }
        }
        return true
    }
}

class DistroModule extends Asset {

    /**
     * @param {any} id
     * @param {string} hash
     * @param {number} size
     * @param {string} from
     * @param {string} to
     * @param {string} type
     **/
    constructor(id, hash, size, from, to, type){
        super(id, hash, size, from, to)
        this.type = type
    }

}

class DLTracker {

    /**
     * @param {Array.<Asset>} dlqueue
     * @param {number} dlsize
     * @param {function(Asset)} callback
     **/
    constructor(dlqueue, dlsize, callback = null){
        this.dlqueue = dlqueue
        this.dlsize = dlsize
        this.callback = callback
    }

}

class Util {

    /**
     * @param {string} desired
     * @param {string} actual 
     **/
    static mcVersionAtLeast(desired, actual){
        const des = desired.split('.')
        const act = actual.split('.')

        for(let i=0; i<des.length; i++){
            if(!(parseInt(act[i]) >= parseInt(des[i]))){
                return false
            }
        }
        return true
    }

    static isForgeGradle3(mcVersion, forgeVersion) {

        if(Util.mcVersionAtLeast('1.13', mcVersion)) {
            return true
        }

        try {
            
            const forgeVer = forgeVersion.split('-')[1]

            const maxFG2 = [14, 23, 5, 2847]
            const verSplit = forgeVer.split('.').map(v => Number(v))

            for(let i=0; i<maxFG2.length; i++) {
                if(verSplit[i] > maxFG2[i]) {
                    return true
                } else if(verSplit[i] < maxFG2[i]) {
                    return false
                }
            }
        
            return false

        } catch(err) {
            throw new Error('Forge version is complex (changed).. launcher requires a patch.')
        }
    }

    static isAutoconnectBroken(forgeVersion) {

        const minWorking = [31, 2, 15]
        const verSplit = forgeVersion.split('.').map(v => Number(v))

        if(verSplit[0] === 31) {
            for(let i=0; i<minWorking.length; i++) {
                if(verSplit[i] > minWorking[i]) {
                    return false
                } else if(verSplit[i] < minWorking[i]) {
                    return true
                }
            }
        }

        return false
    }

}


class JavaGuard extends EventEmitter {

    constructor(mcVersion){
        super()
        this.mcVersion = mcVersion
    }

    /**
     * @typedef OpenJDKData
     * @property {string} uri
     * @property {number} size
     * @property {string} name
     **/

    /**
     * @param {string} major
     * @returns {Promise.<OpenJDKData>}
     **/
    static _latestOpenJDK(major = '8'){

        if(process.platform === 'darwin') {
            return this._latestCorretto(major)
        } else {
            return this._latestAdoptium(major)
        }
    }

    static _latestAdoptium(major) {

        const majorNum = Number(major)
        const sanitizedOS = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'mac' : process.platform)
        const url = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?vendor=eclipse`

        return new Promise((resolve, reject) => {
            request({url, json: true}, (err, resp, body) => {
                if(!err && body.length > 0){

                    const targetBinary = body.find(entry => {
                        return entry.version.major === majorNum
                            && entry.binary.os === sanitizedOS
                            && entry.binary.image_type === 'jdk'
                            && entry.binary.architecture === 'x64'
                    })

                    if(targetBinary != null) {
                        resolve({
                            uri: targetBinary.binary.package.link,
                            size: targetBinary.binary.package.size,
                            name: targetBinary.binary.package.name
                        })
                    } else {
                        resolve(null)
                    }
                } else {
                    resolve(null)
                }
            })
        })
    }

    static _latestCorretto(major) {

        let sanitizedOS, ext

        switch(process.platform) {
            case 'win32':
                sanitizedOS = 'windows'
                ext = 'zip'
                break
            case 'darwin':
                sanitizedOS = 'macos'
                ext = 'tar.gz'
                break
            case 'linux':
                sanitizedOS = 'linux'
                ext = 'tar.gz'
                break
            default:
                sanitizedOS = process.platform
                ext = 'tar.gz'
                break
        }

        const url = `https://corretto.aws/downloads/latest/amazon-corretto-${major}-x64-${sanitizedOS}-jdk.${ext}`

        return new Promise((resolve, reject) => {
            request.head({url, json: true}, (err, resp) => {
                if(!err && resp.statusCode === 200){
                    resolve({
                        uri: url,
                        size: parseInt(resp.headers['content-length']),
                        name: url.substr(url.lastIndexOf('/')+1)
                    })
                } else {
                    resolve(null)
                }
            })
        })

    }

    /**
     * @param {string} rootDir
     * @returns {string}
     **/
    static javaExecFromRoot(rootDir){
        if(process.platform === 'win32'){
            return path.join(rootDir, 'bin', 'javaw.exe')
        } else if(process.platform === 'darwin'){
            return path.join(rootDir, 'Contents', 'Home', 'bin', 'java')
        } else if(process.platform === 'linux'){
            return path.join(rootDir, 'bin', 'java')
        }
        return rootDir
    }

    /**
     * @param {string} pth
     * @returns {boolean}
     **/
    static isJavaExecPath(pth){
        if(process.platform === 'win32'){
            return pth.endsWith(path.join('bin', 'javaw.exe'))
        } else if(process.platform === 'darwin'){
            return pth.endsWith(path.join('bin', 'java'))
        } else if(process.platform === 'linux'){
            return pth.endsWith(path.join('bin', 'java'))
        }
        return false
    }

    /**
     * @returns {Promise.<Object>}
     **/
    static loadMojangLauncherData(){
        return new Promise((resolve, reject) => {
            request.get('https://launchermeta.mojang.com/mc/launcher.json', (err, resp, body) => {
                if(err){
                    resolve(null)
                } else {
                    resolve(JSON.parse(body))
                }
            })
        })
    }

    /**
     * @param {string} verString
     * @returns
     **/
    static parseJavaRuntimeVersion(verString){
        const major = verString.split('.')[0]
        if(major == 1){
            return JavaGuard._parseJavaRuntimeVersion_8(verString)
        } else {
            return JavaGuard._parseJavaRuntimeVersion_9(verString)
        }
    }

    /**
     * @param {string} verString
     * @returns
     **/
    static _parseJavaRuntimeVersion_8(verString){
        const ret = {}
        let pts = verString.split('-')
        ret.build = parseInt(pts[1].substring(1))
        pts = pts[0].split('_')
        ret.update = parseInt(pts[1])
        ret.major = parseInt(pts[0].split('.')[1])
        return ret
    }

    /**
     * @param {string} verString
     * @returns
     **/
    static _parseJavaRuntimeVersion_9(verString){

        const ret = {}
        let pts = verString.split('+')
        ret.build = parseInt(pts[1])
        pts = pts[0].split('.')
        ret.major = parseInt(pts[0])
        ret.minor = parseInt(pts[1])
        ret.revision = parseInt(pts[2])
        return ret
    }

    /**
     * @param {string} stderr
     * 
     * @returns {Promise.<Object>}
     * 
     **/
    _validateJVMProperties(stderr){
        const res = stderr
        const props = res.split('\n')

        const goal = 2
        let checksum = 0

        const meta = {}

        for(let i=0; i<props.length; i++){
            if(props[i].indexOf('sun.arch.data.model') > -1){
                let arch = props[i].split('=')[1].trim()
                arch = parseInt(arch)
                console.log(props[i].trim())
                if(arch === 64){
                    meta.arch = arch
                    ++checksum
                    if(checksum === goal){
                        break
                    }
                }
            } else if(props[i].indexOf('java.runtime.version') > -1){
                let verString = props[i].split('=')[1].trim()
                console.log(props[i].trim())
                const verOb = JavaGuard.parseJavaRuntimeVersion(verString)
                if(verOb.major < 9){
                    if(verOb.major === 8 && verOb.update > 52){
                        meta.version = verOb
                        ++checksum
                        if(checksum === goal){
                            break
                        }
                    }
                } else {
                    if(Util.mcVersionAtLeast('1.13', this.mcVersion)){
                        console.log('Java 9+ not yet tested.')
                    }
                }
            } else if(props[i].lastIndexOf('java.vendor ') > -1) {
                let vendorName = props[i].split('=')[1].trim()
                console.log(props[i].trim())
                meta.vendor = vendorName
            }
        }

        meta.valid = checksum === goal
        
        return meta
    }

    /**
     * @param {string} binaryExecPath
     * 
     * @returns {Promise.<Object>}
     * 
     **/
    _validateJavaBinary(binaryExecPath){

        return new Promise((resolve, reject) => {
            if(!JavaGuard.isJavaExecPath(binaryExecPath)){
                resolve({valid: false})
            } else if(fs.existsSync(binaryExecPath)){
                console.log(typeof binaryExecPath)
                if(binaryExecPath.indexOf('javaw.exe') > -1) {
                    binaryExecPath.replace('javaw.exe', 'java.exe')
                }
                child_process.exec('"' + binaryExecPath + '" -XshowSettings:properties', (err, stdout, stderr) => {
                    try {
                        resolve(this._validateJVMProperties(stderr))
                    } catch (err){
                        resolve({valid: false})
                    }
                })
            } else {
                resolve({valid: false})
            }
        })
        
    }

    /**
     * @returns {string}
     **/
    static _scanJavaHome(){
        const jHome = process.env.JAVA_HOME
        try {
            let res = fs.existsSync(jHome)
            return res ? jHome : null
        } catch (err) {
            return null
        }
    }

    /**
     * @returns {Promise.<Set.<string>>}
     * 
     **/
    static _scanRegistry(){

        return new Promise((resolve, reject) => {
            const regKeys = [
                '\\SOFTWARE\\JavaSoft\\Java Runtime Environment',
                '\\SOFTWARE\\JavaSoft\\Java Development Kit'
            ]

            let keysDone = 0

            const candidates = new Set()

            for(let i=0; i<regKeys.length; i++){
                const key = new Registry({
                    hive: Registry.HKLM,
                    key: regKeys[i],
                    arch: 'x64'
                })
                key.keyExists((err, exists) => {
                    if(exists) {
                        key.keys((err, javaVers) => {
                            if(err){
                                keysDone++
                                console.error(err)
                                if(keysDone === regKeys.length){
                                    resolve(candidates)
                                }
                            } else {
                                if(javaVers.length === 0){
                                    keysDone++
                                    if(keysDone === regKeys.length){
                                        resolve(candidates)
                                    }
                                } else {

                                    let numDone = 0

                                    for(let j=0; j<javaVers.length; j++){
                                        const javaVer = javaVers[j]
                                        const vKey = javaVer.key.substring(javaVer.key.lastIndexOf('\\')+1)
                                        if(parseFloat(vKey) === 1.8){
                                            javaVer.get('JavaHome', (err, res) => {
                                                const jHome = res.value
                                                if(jHome.indexOf('(x86)') === -1){
                                                    candidates.add(jHome)
                                                }
                                                numDone++
                                                if(numDone === javaVers.length){
                                                    keysDone++
                                                    if(keysDone === regKeys.length){
                                                        resolve(candidates)
                                                    }
                                                }
                                            })
                                        } else {

                                            numDone++
                                            if(numDone === javaVers.length){
                                                keysDone++
                                                if(keysDone === regKeys.length){
                                                    resolve(candidates)
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        })
                    } else {

                        keysDone++
                        if(keysDone === regKeys.length){
                            resolve(candidates)
                        }
                    }
                })
            }

        })
        
    }

    /**
     * @returns {string}
     **/
    static _scanInternetPlugins(){
        const pth = '/Library/Internet Plug-Ins/JavaAppletPlugin.plugin'
        const res = fs.existsSync(JavaGuard.javaExecFromRoot(pth))
        return res ? pth : null
    }

    /**
     * @param {string} scanDir
     * @returns {Promise.<Set.<string>>}
     **/
    static async _scanFileSystem(scanDir){

        let res = new Set()

        if(await fs.pathExists(scanDir)) {

            const files = await fs.readdir(scanDir)
            for(let i=0; i<files.length; i++){

                const combinedPath = path.join(scanDir, files[i])
                const execPath = JavaGuard.javaExecFromRoot(combinedPath)

                if(await fs.pathExists(execPath)) {
                    res.add(combinedPath)
                }
            }
        }

        return res

    }

    /**
     * 
     * @param {Set.<string>} rootSet
     * @returns {Promise.<Object[]>}
     **/
    async _validateJavaRootSet(rootSet){

        const rootArr = Array.from(rootSet)
        const validArr = []

        for(let i=0; i<rootArr.length; i++){

            const execPath = JavaGuard.javaExecFromRoot(rootArr[i])
            const metaOb = await this._validateJavaBinary(execPath)

            if(metaOb.valid){
                metaOb.execPath = execPath
                validArr.push(metaOb)
            }

        }

        return validArr

    }

    /**
     * @param {Object[]} validArr
     * @returns {Object[]}
     **/
    static _sortValidJavaArray(validArr){
        const retArr = validArr.sort((a, b) => {

            if(a.version.major === b.version.major){
                
                if(a.version.major < 9){
                    if(a.version.update === b.version.update){
                        if(a.version.build === b.version.build){
    
                            if(a.execPath.toLowerCase().indexOf('jdk') > -1){
                                return b.execPath.toLowerCase().indexOf('jdk') > -1 ? 0 : 1
                            } else {
                                return -1
                            }
    
                        } else {
                            return a.version.build > b.version.build ? -1 : 1
                        }
                    } else {
                        return  a.version.update > b.version.update ? -1 : 1
                    }
                } else {
                    if(a.version.minor === b.version.minor){
                        if(a.version.revision === b.version.revision){
                            if(a.execPath.toLowerCase().indexOf('jdk') > -1){
                                return b.execPath.toLowerCase().indexOf('jdk') > -1 ? 0 : 1
                            } else {
                                return -1
                            }
    
                        } else {
                            return a.version.revision > b.version.revision ? -1 : 1
                        }
                    } else {
                        return  a.version.minor > b.version.minor ? -1 : 1
                    }
                }

            } else {
                return a.version.major > b.version.major ? -1 : 1
            }
        })

        return retArr
    }

    /**
     * @param {string} dataDir 
     * @returns {Promise.<string>}
     * 
     **/
    async _win32JavaValidate(dataDir){

        let pathSet1 = await JavaGuard._scanRegistry()
        if(pathSet1.size === 0){
            pathSet1 = new Set([
                ...pathSet1,
                ...(await JavaGuard._scanFileSystem('C:\\Program Files\\Java')),
                ...(await JavaGuard._scanFileSystem('C:\\Program Files\\Eclipse Foundation')),
                ...(await JavaGuard._scanFileSystem('C:\\Program Files\\AdoptOpenJDK'))
            ])
        }

        const pathSet2 = await JavaGuard._scanFileSystem(path.join(dataDir, 'runtime', 'x64'))

        const uberSet = new Set([...pathSet1, ...pathSet2])

        const jHome = JavaGuard._scanJavaHome()
        if(jHome != null && jHome.indexOf('(x86)') === -1){
            uberSet.add(jHome)
        }

        let pathArr = await this._validateJavaRootSet(uberSet)
        pathArr = JavaGuard._sortValidJavaArray(pathArr)

        if(pathArr.length > 0){
            return pathArr[0].execPath
        } else {
            return null
        }

    }

    /**
     * @param {string} dataDir 
     * @returns {Promise.<string>}
     * 
     **/
    async _darwinJavaValidate(dataDir){

        const pathSet1 = await JavaGuard._scanFileSystem('/Library/Java/JavaVirtualMachines')
        const pathSet2 = await JavaGuard._scanFileSystem(path.join(dataDir, 'runtime', 'x64'))

        const uberSet = new Set([...pathSet1, ...pathSet2])

        const iPPath = JavaGuard._scanInternetPlugins()
        if(iPPath != null){
            uberSet.add(iPPath)
        }

        let jHome = JavaGuard._scanJavaHome()
        if(jHome != null){
            if(jHome.contains('/Contents/Home')){
                jHome = jHome.substring(0, jHome.indexOf('/Contents/Home'))
            }
            uberSet.add(jHome)
        }

        let pathArr = await this._validateJavaRootSet(uberSet)
        pathArr = JavaGuard._sortValidJavaArray(pathArr)

        if(pathArr.length > 0){
            return pathArr[0].execPath
        } else {
            return null
        }
    }

    /**
     * @param {string} dataDir 
     * @returns {Promise.<string>}
     **/
    async _linuxJavaValidate(dataDir){

        const pathSet1 = await JavaGuard._scanFileSystem('/usr/lib/jvm')
        const pathSet2 = await JavaGuard._scanFileSystem(path.join(dataDir, 'runtime', 'x64'))
        
        const uberSet = new Set([...pathSet1, ...pathSet2])

        const jHome = JavaGuard._scanJavaHome()
        if(jHome != null){
            uberSet.add(jHome)
        }
        
        let pathArr = await this._validateJavaRootSet(uberSet)
        pathArr = JavaGuard._sortValidJavaArray(pathArr)

        if(pathArr.length > 0){
            return pathArr[0].execPath
        } else {
            return null
        }
    }

    /**
     * 
     * 
     * @param {string} dataDir 
     * @returns {string}
     **/
    async validateJava(dataDir){
        return await this['_' + process.platform + 'JavaValidate'](dataDir)
    }

}

class AssetGuard extends EventEmitter {

    /**
     * @param {string} commonPath 
     * @param {string} javaexec 
     * 
     **/
    constructor(commonPath, javaexec){
        super()
        this.totaldlsize = 0
        this.progress = 0
        this.assets = new DLTracker([], 0)
        this.libraries = new DLTracker([], 0)
        this.files = new DLTracker([], 0)
        this.forge = new DLTracker([], 0)
        this.java = new DLTracker([], 0)
        this.extractQueue = []
        this.commonPath = commonPath
        this.javaexec = javaexec
    }

    /**
     * @param {Buffer} buf
     * @param {string} algo
     * @returns {string} 
     **/
    static _calculateHash(buf, algo){
        return crypto.createHash(algo).update(buf).digest('hex')
    }

    /**
     * @param {string} content
     * @returns {Object}
     **/
    static _parseChecksumsFile(content){
        let finalContent = {}
        let lines = content.split('\n')
        for(let i=0; i<lines.length; i++){
            let bits = lines[i].split(' ')
            if(bits[1] == null) {
                continue
            }
            finalContent[bits[1]] = bits[0]
        }
        return finalContent
    }

    /**
     * @param {string} filePath
     * @param {string} algo
     * @param {string} hash
     * @returns {boolean}
     **/
    static _validateLocal(filePath, algo, hash){
        if(fs.existsSync(filePath)){
            if(hash == null){
                return true
            }
            let buf = fs.readFileSync(filePath)
            let calcdhash = AssetGuard._calculateHash(buf, algo)
            return calcdhash === hash.toLowerCase()
        }
        return false
    }

    /**
     * @param {string} filePath
     * @param {Array.<string>} checksums
     * @returns {boolean}
     **/
    static _validateForgeChecksum(filePath, checksums){
        if(fs.existsSync(filePath)){
            if(checksums == null || checksums.length === 0){
                return true
            }
            let buf = fs.readFileSync(filePath)
            let calcdhash = AssetGuard._calculateHash(buf, 'sha1')
            let valid = checksums.includes(calcdhash)
            if(!valid && filePath.endsWith('.jar')){
                valid = AssetGuard._validateForgeJar(filePath, checksums)
            }
            return valid
        }
        return false
    }

    /**
     * @param {Buffer} buf
     * @param {Array.<string>} checksums
     * @returns {boolean}
     **/
    static _validateForgeJar(buf, checksums){
        const hashes = {}
        let expected = {}

        const zip = new AdmZip(buf)
        const zipEntries = zip.getEntries()

        for(let i=0; i<zipEntries.length; i++){
            let entry = zipEntries[i]
            if(entry.entryName === 'checksums.sha1'){
                expected = AssetGuard._parseChecksumsFile(zip.readAsText(entry))
            }
            hashes[entry.entryName] = AssetGuard._calculateHash(entry.getData(), 'sha1')
        }

        if(!checksums.includes(hashes['checksums.sha1'])){
            return false
        }

        const expectedEntries = Object.keys(expected)
        for(let i=0; i<expectedEntries.length; i++){
            if(expected[expectedEntries[i]] !== hashes[expectedEntries[i]]){
                return false
            }
        }
        return true
    }

    /**
     * @param {Array.<string>} filePaths
     * @returns {Promise.<void>}
     **/
    static _extractPackXZ(filePaths, javaExecutable){
        console.log('[PackXZExtract] Starting')
        return new Promise((resolve, reject) => {

            let libPath
            if(isDev){
                libPath = path.join(process.cwd(), 'libraries', 'java', 'PackXZExtract.jar')
            } else {
                if(process.platform === 'darwin'){
                    libPath = path.join(process.cwd(),'Contents', 'Resources', 'libraries', 'java', 'PackXZExtract.jar')
                } else {
                    libPath = path.join(process.cwd(), 'resources', 'libraries', 'java', 'PackXZExtract.jar')
                }
            }

            const filePath = filePaths.join(',')
            const child = child_process.spawn(javaExecutable, ['-jar', libPath, '-packxz', filePath])
            child.stdout.on('data', (data) => {
                console.log('[PackXZExtract]', data.toString('utf8'))
            })
            child.stderr.on('data', (data) => {
                console.log('[PackXZExtract]', data.toString('utf8'))
            })
            child.on('close', (code, signal) => {
                console.log('[PackXZExtract]', 'Exited with code', code)
                resolve()
            })
        })
    }

    /**
     * @param {Asset} asset
     * @param {string} commonPath 
     * @returns {Promise.<Object>}
     **/
    static _finalizeForgeAsset(asset, commonPath){
        return new Promise((resolve, reject) => {
            fs.readFile(asset.to, (err, data) => {
                const zip = new AdmZip(data)
                const zipEntries = zip.getEntries()

                for(let i=0; i<zipEntries.length; i++){
                    if(zipEntries[i].entryName === 'version.json'){
                        const forgeVersion = JSON.parse(zip.readAsText(zipEntries[i]))
                        const versionPath = path.join(commonPath, 'versions', forgeVersion.id)
                        const versionFile = path.join(versionPath, forgeVersion.id + '.json')
                        if(!fs.existsSync(versionFile)){
                            fs.ensureDirSync(versionPath)
                            fs.writeFileSync(path.join(versionPath, forgeVersion.id + '.json'), zipEntries[i].getData())
                            resolve(forgeVersion)
                        } else {
                            
                            resolve(JSON.parse(fs.readFileSync(versionFile, 'utf-8')))
                        }
                        return
                    }
                }
                
                reject('Unable to finalize Forge processing, version.json not found! Has forge changed their format?')
            })
        })
    }

    /**
     * @param {string} version
     * @param {boolean} force
     * @returns {Promise.<Object>}
     **/
    loadVersionData(version, force = false){
        const self = this
        return new Promise(async (resolve, reject) => {
            const versionPath = path.join(self.commonPath, 'versions', version)
            const versionFile = path.join(versionPath, version + '.json')
            if(!fs.existsSync(versionFile) || force){
                const url = await self._getVersionDataUrl(version)
                console.log('Preparing download of ' + version + ' assets.')
                fs.ensureDirSync(versionPath)
                const stream = request(url).pipe(fs.createWriteStream(versionFile))
                stream.on('finish', () => {
                    resolve(JSON.parse(fs.readFileSync(versionFile)))
                })
            } else {
                resolve(JSON.parse(fs.readFileSync(versionFile)))
            }
        })
    }

    /**
     * @param {string} version
     * @returns {Promise.<string>}
     **/
    _getVersionDataUrl(version){
        return new Promise((resolve, reject) => {
            request('https://launchermeta.mojang.com/mc/game/version_manifest.json', (error, resp, body) => {
                if(error){
                    reject(error)
                } else {
                    const manifest = JSON.parse(body)

                    for(let v of manifest.versions){
                        if(v.id === version){
                            resolve(v.url)
                        }
                    }

                    resolve(null)
                }
            })
        })
    }



    /**
     * @param {Object} versionData
     * @param {boolean} force
     * @returns {Promise.<void>}
     **/
    validateAssets(versionData, force = false){
        const self = this
        return new Promise((resolve, reject) => {
            self._assetChainIndexData(versionData, force).then(() => {
                resolve()
            })
        })
    }

    /**
     * @param {Object} versionData
     * @param {boolean} force
     * @returns {Promise.<void>}
     **/
    _assetChainIndexData(versionData, force = false){
        const self = this
        return new Promise((resolve, reject) => {
            const assetIndex = versionData.assetIndex
            const name = assetIndex.id + '.json'
            const indexPath = path.join(self.commonPath, 'assets', 'indexes')
            const assetIndexLoc = path.join(indexPath, name)

            let data = null
            if(!fs.existsSync(assetIndexLoc) || force){
                console.log('Downloading ' + versionData.id + ' asset index.')
                fs.ensureDirSync(indexPath)
                const stream = request(assetIndex.url).pipe(fs.createWriteStream(assetIndexLoc))
                stream.on('finish', () => {
                    data = JSON.parse(fs.readFileSync(assetIndexLoc, 'utf-8'))
                    self._assetChainValidateAssets(versionData, data).then(() => {
                        resolve()
                    })
                })
            } else {
                data = JSON.parse(fs.readFileSync(assetIndexLoc, 'utf-8'))
                self._assetChainValidateAssets(versionData, data).then(() => {
                    resolve()
                })
            }
        })
    }

    /**
     * @param {Object} versionData
     * @param {boolean} force
     * @returns {Promise.<void>}
     **/
    _assetChainValidateAssets(versionData, indexData){
        const self = this
        return new Promise((resolve, reject) => {
            const resourceURL = 'https://resources.download.minecraft.net/'
            const localPath = path.join(self.commonPath, 'assets')
            const objectPath = path.join(localPath, 'objects')

            const assetDlQueue = []
            let dlSize = 0
            let acc = 0
            const total = Object.keys(indexData.objects).length
            async.forEachOfLimit(indexData.objects, 10, (value, key, cb) => {
                acc++
                self.emit('progress', 'assets', acc, total)
                const hash = value.hash
                const assetName = path.join(hash.substring(0, 2), hash)
                const urlName = hash.substring(0, 2) + '/' + hash
                const ast = new Asset(key, hash, value.size, resourceURL + urlName, path.join(objectPath, assetName))
                if(!AssetGuard._validateLocal(ast.to, 'sha1', ast.hash)){
                    dlSize += (ast.size*1)
                    assetDlQueue.push(ast)
                }
                cb()
            }, (err) => {
                self.assets = new DLTracker(assetDlQueue, dlSize)
                resolve()
            })
        })
    }

    /**
     * @param {Object} versionData
     * @returns {Promise.<void>}
     **/
    validateLibraries(versionData){
        const self = this
        return new Promise((resolve, reject) => {

            const libArr = versionData.libraries
            const libPath = path.join(self.commonPath, 'libraries')

            const libDlQueue = []
            let dlSize = 0

            async.eachLimit(libArr, 5, (lib, cb) => {
                if(Library.validateRules(lib.rules, lib.natives)){
                    let artifact = (lib.natives == null) ? lib.downloads.artifact : lib.downloads.classifiers[lib.natives[Library.mojangFriendlyOS()].replace('${arch}', process.arch.replace('x', ''))]
                    const libItm = new Library(lib.name, artifact.sha1, artifact.size, artifact.url, path.join(libPath, artifact.path))
                    if(!AssetGuard._validateLocal(libItm.to, 'sha1', libItm.hash)){
                        dlSize += (libItm.size*1)
                        libDlQueue.push(libItm)
                    }
                }
                cb()
            }, (err) => {
                self.libraries = new DLTracker(libDlQueue, dlSize)
                resolve()
            })
        })
    }

    /**
     * @param {Object} versionData
     * @returns {Promise.<void>}
     **/
    validateMiscellaneous(versionData){
        const self = this
        return new Promise(async (resolve, reject) => {
            await self.validateClient(versionData)
            await self.validateLogConfig(versionData)
            resolve()
        })
    }

    /**
     * @param {Object} versionData
     * @param {boolean} force
     * @returns {Promise.<void>}
     **/
    validateClient(versionData, force = false){
        const self = this
        return new Promise((resolve, reject) => {
            const clientData = versionData.downloads.client
            const version = versionData.id
            const targetPath = path.join(self.commonPath, 'versions', version)
            const targetFile = version + '.jar'

            let client = new Asset(version + ' client', clientData.sha1, clientData.size, clientData.url, path.join(targetPath, targetFile))

            if(!AssetGuard._validateLocal(client.to, 'sha1', client.hash) || force){
                self.files.dlqueue.push(client)
                self.files.dlsize += client.size*1
                resolve()
            } else {
                resolve()
            }
        })
    }

    /**
     * @param {Object} versionData
     * @param {boolean} force
     * @returns {Promise.<void>}
     **/
    validateLogConfig(versionData){
        const self = this
        return new Promise((resolve, reject) => {
            const client = versionData.logging.client
            const file = client.file
            const targetPath = path.join(self.commonPath, 'assets', 'log_configs')

            let logConfig = new Asset(file.id, file.sha1, file.size, file.url, path.join(targetPath, file.id))

            if(!AssetGuard._validateLocal(logConfig.to, 'sha1', logConfig.hash)){
                self.files.dlqueue.push(logConfig)
                self.files.dlsize += logConfig.size*1
                resolve()
            } else {
                resolve()
            }
        })
    }

    /**
     * @param {Server} server
     * @returns {Promise.<Object>}
     **/
    validateDistribution(server){
        const self = this
        return new Promise((resolve, reject) => {
            self.forge = self._parseDistroModules(server.getModules(), server.getMinecraftVersion(), server.getID())
            resolve(server)
        })
    }

    _parseDistroModules(modules, version, servid){
        let alist = []
        let asize = 0
        for(let ob of modules){
            let obArtifact = ob.getArtifact()
            let obPath = obArtifact.getPath()
            let artifact = new DistroModule(ob.getIdentifier(), obArtifact.getHash(), obArtifact.getSize(), obArtifact.getURL(), obPath, ob.getType())
            const validationPath = obPath.toLowerCase().endsWith('.pack.xz') ? obPath.substring(0, obPath.toLowerCase().lastIndexOf('.pack.xz')) : obPath
            if(!AssetGuard._validateLocal(validationPath, 'MD5', artifact.hash)){
                asize += artifact.size*1
                alist.push(artifact)
                if(validationPath !== obPath) this.extractQueue.push(obPath)
            }
            if(ob.getSubModules() != null){
                let dltrack = this._parseDistroModules(ob.getSubModules(), version, servid)
                asize += dltrack.dlsize*1
                alist = alist.concat(dltrack.dlqueue)
            }
        }

        return new DLTracker(alist, asize)
    }

    /**
     * @param {string} server
     * @returns {Promise.<Object>} 
     **/
    loadForgeData(server){
        const self = this
        return new Promise(async (resolve, reject) => {
            const modules = server.getModules()
            for(let ob of modules){
                const type = ob.getType()
                if(type === DistroManager.Types.ForgeHosted || type === DistroManager.Types.Forge){
                    if(Util.isForgeGradle3(server.getMinecraftVersion(), ob.getVersion())){
                        for(let sub of ob.getSubModules()){
                            if(sub.getType() === DistroManager.Types.VersionManifest){
                                resolve(JSON.parse(fs.readFileSync(sub.getArtifact().getPath(), 'utf-8')))
                                return
                            }
                        }
                        reject('No forge version manifest found!')
                        return
                    } else {
                        let obArtifact = ob.getArtifact()
                        let obPath = obArtifact.getPath()
                        let asset = new DistroModule(ob.getIdentifier(), obArtifact.getHash(), obArtifact.getSize(), obArtifact.getURL(), obPath, type)
                        try {
                            let forgeData = await AssetGuard._finalizeForgeAsset(asset, self.commonPath)
                            resolve(forgeData)
                        } catch (err){
                            reject(err)
                        }
                        return
                    }
                }
            }
            reject('No forge module found!')
        })
    }

    _parseForgeLibraries(){
    }

    _enqueueOpenJDK(dataDir){
        return new Promise((resolve, reject) => {
            JavaGuard._latestOpenJDK('8').then(verData => {
                if(verData != null){

                    dataDir = path.join(dataDir, 'runtime', 'x64')
                    const fDir = path.join(dataDir, verData.name)
                    const jre = new Asset(verData.name, null, verData.size, verData.uri, fDir)
                    this.java = new DLTracker([jre], jre.size, (a, self) => {
                        if(verData.name.endsWith('zip')){

                            this._extractJdkZip(a.to, dataDir, self)

                        } else {
                            let h = null
                            fs.createReadStream(a.to)
                                .on('error', err => console.log(err))
                                .pipe(zlib.createGunzip())
                                .on('error', err => console.log(err))
                                .pipe(tar.extract(dataDir, {
                                    map: (header) => {
                                        if(h == null){
                                            h = header.name
                                        }
                                    }
                                }))
                                .on('error', err => console.log(err))
                                .on('finish', () => {
                                    fs.unlink(a.to, err => {
                                        if(err){
                                            console.log(err)
                                        }
                                        if(h.indexOf('/') > -1){
                                            h = h.substring(0, h.indexOf('/'))
                                        }
                                        const pos = path.join(dataDir, h)
                                        self.emit('complete', 'java', JavaGuard.javaExecFromRoot(pos))
                                    })
                                })
                        }
                    })
                    resolve(true)

                } else {
                    resolve(false)
                }
            })
        })

    }

    async _extractJdkZip(zipPath, runtimeDir, self) {
                            
        const zip = new StreamZip.async({
            file: zipPath,
            storeEntries: true
        })

        let pos = ''
        try {
            const entries = await zip.entries()
            pos = path.join(runtimeDir, Object.keys(entries)[0])

            console.log('Extracting jdk..')
            await zip.extract(null, runtimeDir)
            console.log('Cleaning up..')
            await fs.remove(zipPath)
            console.log('Jdk extraction complete.')

        } catch(err) {
            console.log(err)
        } finally {
            zip.close()
            self.emit('complete', 'java', JavaGuard.javaExecFromRoot(pos))
        }
    }

    /**
     * @param {string} identifier
     * @param {number} limit
     * @returns {boolean}
     **/
    startAsyncProcess(identifier, limit = 5){

        const self = this
        const dlTracker = this[identifier]
        const dlQueue = dlTracker.dlqueue

        if(dlQueue.length > 0){
            console.log('DLQueue', dlQueue)

            async.eachLimit(dlQueue, limit, (asset, cb) => {

                fs.ensureDirSync(path.join(asset.to, '..'))

                let req = request(asset.from)
                req.pause()

                req.on('response', (resp) => {

                    if(resp.statusCode === 200){

                        let doHashCheck = false
                        const contentLength = parseInt(resp.headers['content-length'])

                        if(contentLength !== asset.size){
                            console.log(`WARN: Got ${contentLength} bytes for ${asset.id}: Expected ${asset.size}`)
                            doHashCheck = true
                            this.totaldlsize -= asset.size
                            this.totaldlsize += contentLength
                        }

                        let writeStream = fs.createWriteStream(asset.to)
                        writeStream.on('close', () => {
                            if(dlTracker.callback != null){
                                dlTracker.callback.apply(dlTracker, [asset, self])
                            }

                            if(doHashCheck){
                                const v = AssetGuard._validateLocal(asset.to, asset.type != null ? 'md5' : 'sha1', asset.hash)
                                if(v){
                                    console.log(`Hashes match for ${asset.id}, byte mismatch is an issue in the distro index.`)
                                } else {
                                    console.error(`Hashes do not match, ${asset.id} may be corrupted.`)
                                }
                            }

                            cb()
                        })
                        req.pipe(writeStream)
                        req.resume()

                    } else {

                        req.abort()
                        console.log(`Failed to download ${asset.id}(${typeof asset.from === 'object' ? asset.from.url : asset.from}). Response code ${resp.statusCode}`)
                        self.progress += asset.size*1
                        self.emit('progress', 'download', self.progress, self.totaldlsize)
                        cb()

                    }

                })

                req.on('error', (err) => {
                    self.emit('error', 'download', err)
                })

                req.on('data', (chunk) => {
                    self.progress += chunk.length
                    self.emit('progress', 'download', self.progress, self.totaldlsize)
                })

            }, (err) => {

                if(err){
                    console.log('An item in ' + identifier + ' failed to process')
                } else {
                    console.log('All ' + identifier + ' have been processed successfully')
                }
                self[identifier] = new DLTracker([], 0)

                if(self.progress >= self.totaldlsize) {
                    if(self.extractQueue.length > 0){
                        self.emit('progress', 'extract', 1, 1)
                        AssetGuard._extractPackXZ(self.extractQueue, self.javaexec).then(() => {
                            self.extractQueue = []
                            self.emit('complete', 'download')
                        })
                    } else {
                        self.emit('complete', 'download')
                    }
                }

            })

            return true

        } else {
            return false
        }
    }

    /**
     * @param {Array.<{id: string, limit: number}>} identifiers
     **/
    processDlQueues(identifiers = [{id:'assets', limit:20}, {id:'libraries', limit:5}, {id:'files', limit:5}, {id:'forge', limit:5}]){
        return new Promise((resolve, reject) => {
            let shouldFire = true

            this.totaldlsize = 0
            this.progress = 0

            for(let iden of identifiers){
                this.totaldlsize += this[iden.id].dlsize
            }

            this.once('complete', (data) => {
                resolve()
            })

            for(let iden of identifiers){
                let r = this.startAsyncProcess(iden.id, iden.limit)
                if(r) shouldFire = false
            }

            if(shouldFire){
                this.emit('complete', 'download')
            }
        })
    }

    async validateEverything(serverid, dev = false){

        try {
            if(!ConfigManager.isLoaded()){
                ConfigManager.load()
            }
            DistroManager.setDevMode(dev)
            const dI = await DistroManager.pullLocal()
    
            const server = dI.getServer(serverid)
            await this.validateDistribution(server)
            this.emit('validate', 'distribution')
            const versionData = await this.loadVersionData(server.getMinecraftVersion())
            this.emit('validate', 'version')
            await this.validateAssets(versionData)
            this.emit('validate', 'assets')
            await this.validateLibraries(versionData)
            this.emit('validate', 'libraries')
            await this.validateMiscellaneous(versionData)
            this.emit('validate', 'files')
            await this.processDlQueues()
            const forgeData = await this.loadForgeData(server)
        
            return {
                versionData,
                forgeData
            }

        } catch (err){
            return {
                versionData: null,
                forgeData: null,
                error: err
            }
        }
        

    }

}

module.exports = {
    Util,
    AssetGuard,
    JavaGuard,
    Asset,
    Library
}