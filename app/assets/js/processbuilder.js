const AdmZip                = require('adm-zip')
const child_process         = require('child_process')
const crypto                = require('crypto')
const fs                    = require('fs-extra')
const os                    = require('os')
const path                  = require('path')
const { URL }               = require('url')

const { Util, Library }  = require('./assetguard')
const ConfigManager            = require('./configmanager')
const DistroManager            = require('./distromanager')
const LoggerUtil               = require('./loggerutil')

const logger = LoggerUtil('%c[ProcessBuilder]', 'color: #003996; font-weight: bold')

class ProcessBuilder {

    constructor(distroServer, versionData, forgeData, authUser, launcherVersion){
        this.gameDir = path.join(ConfigManager.getInstanceDirectory(), distroServer.getID())
        this.commonDir = ConfigManager.getCommonDirectory()
        this.server = distroServer
        this.versionData = versionData
        this.forgeData = forgeData
        this.authUser = authUser
        this.launcherVersion = launcherVersion
        this.forgeModListFile = path.join(this.gameDir, 'forgeMods.list')
        this.fmlDir = path.join(this.gameDir, 'forgeModList.json')
        this.llDir = path.join(this.gameDir, 'liteloaderModList.json')
        this.libPath = path.join(this.commonDir, 'libraries')

        this.usingLiteLoader = false
        this.llPath = null
    }

    build(){
        fs.ensureDirSync(this.gameDir)
        const tempNativePath = path.join(os.tmpdir(), ConfigManager.getTempNativeFolder(), crypto.pseudoRandomBytes(16).toString('hex'))
        process.throwDeprecation = true
        this.setupLiteLoader()
        logger.log('Using liteloader:', this.usingLiteLoader)
        const modObj = this.resolveModConfiguration(ConfigManager.getModConfiguration(this.server.getID()).mods, this.server.getModules())

        if(!Util.mcVersionAtLeast('1.13', this.server.getMinecraftVersion())){
            this.constructJSONModList('forge', modObj.fMods, true)
            if(this.usingLiteLoader){
                this.constructJSONModList('liteloader', modObj.lMods, true)
            }
        }
        
        const uberModArr = modObj.fMods.concat(modObj.lMods)
        let args = this.constructJVMArguments(uberModArr, tempNativePath)

        if(Util.mcVersionAtLeast('1.13', this.server.getMinecraftVersion())){
            args = args.concat(this.constructModList(modObj.fMods))
        }

        logger.log('Launch Arguments:', args)

        const child = child_process.spawn(ConfigManager.getJavaExecutable(), args, {
            cwd: this.gameDir,
            detached: ConfigManager.getLaunchDetached()
        })

        if(ConfigManager.getLaunchDetached()){
            child.unref()
        }

        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')

        const loggerMCstdout = LoggerUtil('%c[Minecraft]', 'color: #36b030; font-weight: bold')
        const loggerMCstderr = LoggerUtil('%c[Minecraft]', 'color: #b03030; font-weight: bold')

        child.stdout.on('data', (data) => {
            loggerMCstdout.log(data)
        })
        child.stderr.on('data', (data) => {
            loggerMCstderr.log(data)
        })
        child.on('close', (code, signal) => {
            logger.log('Exited with code', code)
            fs.remove(tempNativePath, (err) => {
                if(err){
                    logger.warn('Error while deleting temp dir', err)
                } else {
                    logger.log('Temp dir deleted successfully.')
                }
            })
        })

        return child
    }

    /**
     * @param {Object | boolean} modCfg
     * @param {Object} required
     * @returns {boolean}
     **/
    static isModEnabled(modCfg, required = null){
        return modCfg != null ? ((typeof modCfg === 'boolean' && modCfg) || (typeof modCfg === 'object' && (typeof modCfg.value !== 'undefined' ? modCfg.value : true))) : required != null ? required.isDefault() : true
    }
    setupLiteLoader(){
        for(let ll of this.server.getModules()){
            if(ll.getType() === DistroManager.Types.LiteLoader){
                if(!ll.getRequired().isRequired()){
                    const modCfg = ConfigManager.getModConfiguration(this.server.getID()).mods
                    if(ProcessBuilder.isModEnabled(modCfg[ll.getVersionlessID()], ll.getRequired())){
                        if(fs.existsSync(ll.getArtifact().getPath())){
                            this.usingLiteLoader = true
                            this.llPath = ll.getArtifact().getPath()
                        }
                    }
                } else {
                    if(fs.existsSync(ll.getArtifact().getPath())){
                        this.usingLiteLoader = true
                        this.llPath = ll.getArtifact().getPath()
                    }
                }
            }
        }
    }

    /**
     * @param {Object} modCfg
     * @param {Array.<Object>} mdls
     * @returns {{fMods: Array.<Object>, lMods: Array.<Object>}}
     **/
    resolveModConfiguration(modCfg, mdls){
        let fMods = []
        let lMods = []

        for(let mdl of mdls){
            const type = mdl.getType()
            if(type === DistroManager.Types.ForgeMod || type === DistroManager.Types.LiteMod || type === DistroManager.Types.LiteLoader){
                const o = !mdl.getRequired().isRequired()
                const e = ProcessBuilder.isModEnabled(modCfg[mdl.getVersionlessID()], mdl.getRequired())
                if(!o || (o && e)){
                    if(mdl.hasSubModules()){
                        const v = this.resolveModConfiguration(modCfg[mdl.getVersionlessID()].mods, mdl.getSubModules())
                        fMods = fMods.concat(v.fMods)
                        lMods = lMods.concat(v.lMods)
                        if(mdl.type === DistroManager.Types.LiteLoader){
                            continue
                        }
                    }
                    if(mdl.type === DistroManager.Types.ForgeMod){
                        fMods.push(mdl)
                    } else {
                        lMods.push(mdl)
                    }
                }
            }
        }

        return {
            fMods,
            lMods
        }
    }

    _lteMinorVersion(version) {
        return Number(this.forgeData.id.split('-')[0].split('.')[1]) <= Number(version)
    }

    _requiresAbsolute(){
        try {
            if(this._lteMinorVersion(9)) {
                return false
            }
            const ver = this.forgeData.id.split('-')[2]
            const pts = ver.split('.')
            const min = [14, 23, 3, 2655]
            for(let i=0; i<pts.length; i++){
                const parsed = Number.parseInt(pts[i])
                if(parsed < min[i]){
                    return false
                } else if(parsed > min[i]){
                    return true
                }
            }
        } catch (err) {
        }

        return true
    }

    /**
     * @param {'forge' | 'liteloader'} type
     * @param {Array.<Object>} mods
     * @param {boolean} save
     **/
    constructJSONModList(type, mods, save = false){
        const modList = {
            repositoryRoot: ((type === 'forge' && this._requiresAbsolute()) ? 'absolute:' : '') + path.join(this.commonDir, 'modstore')
        }

        const ids = []
        if(type === 'forge'){
            for(let mod of mods){
                ids.push(mod.getExtensionlessID())
            }
        } else {
            for(let mod of mods){
                ids.push(mod.getExtensionlessID() + '@' + mod.getExtension())
            }
        }
        modList.modRef = ids
        
        if(save){
            const json = JSON.stringify(modList, null, 4)
            fs.writeFileSync(type === 'forge' ? this.fmlDir : this.llDir, json, 'UTF-8')
        }

        return modList
    }

    /**
     * @param {Array.<Object>} mods
     **/
    constructModList(mods) {
        const writeBuffer = mods.map(mod => {
            return mod.getExtensionlessID()
        }).join('\n')

        if(writeBuffer) {
            fs.writeFileSync(this.forgeModListFile, writeBuffer, 'UTF-8')
            return [
                '--fml.mavenRoots',
                path.join('..', '..', 'common', 'modstore'),
                '--fml.modLists',
                this.forgeModListFile
            ]
        } else {
            return []
        }

    }

    _processAutoConnectArg(args){
        if(ConfigManager.getAutoConnect() && this.server.isAutoConnect()){
            const serverURL = new URL('my://' + this.server.getAddress())
            args.push('--server')
            args.push(serverURL.hostname)
            if(serverURL.port){
                args.push('--port')
                args.push(serverURL.port)
            }
        }
    }

    /**
     * @param {Array.<Object>} mods
     * @param {string} tempNativePath
     * @returns {Array.<string>}
     **/
    constructJVMArguments(mods, tempNativePath){
        if(Util.mcVersionAtLeast('1.13', this.server.getMinecraftVersion())){
            return this._constructJVMArguments113(mods, tempNativePath)
        } else {
            return this._constructJVMArguments112(mods, tempNativePath)
        }
    }

    /**
     * @param {Array.<Object>} mods
     * @param {string} tempNativePath
     * @returns {Array.<string>}
     **/
    _constructJVMArguments112(mods, tempNativePath){

        let args = []

        args.push('-cp')
        args.push(this.classpathArg(mods, tempNativePath).join(process.platform === 'win32' ? ';' : ':'))

        if(process.platform === 'darwin'){
            args.push('-Xdock:name=UltraLauncher')
            args.push('-Xdock:icon=' + path.join(__dirname, '..', 'images', 'minecraft.icns'))
        }
        args.push('-Xmx' + ConfigManager.getMaxRAM())
        args.push('-Xms' + ConfigManager.getMinRAM())
        args = args.concat(ConfigManager.getJVMOptions())
        args.push('-Djava.library.path=' + tempNativePath)

        args.push(this.forgeData.mainClass)

        args = args.concat(this._resolveForgeArgs())

        return args
    }

    /**
     * @param {Array.<Object>} mods
     * @param {string} tempNativePath
     * @returns {Array.<string>}
     **/
    _constructJVMArguments113(mods, tempNativePath){

        const argDiscovery = /\${*(.*)}/

        let args = this.versionData.arguments.jvm

        if(process.platform === 'darwin'){
            args.push('-Xdock:name=UltraLauncher')
            args.push('-Xdock:icon=' + path.join(__dirname, '..', 'images', 'minecraft.icns'))
        }
        args.push('-Xmx' + ConfigManager.getMaxRAM())
        args.push('-Xms' + ConfigManager.getMinRAM())
        args = args.concat(ConfigManager.getJVMOptions())
        args.push(this.forgeData.mainClass)
        args = args.concat(this.versionData.arguments.game)

        for(let i=0; i<args.length; i++){
            if(typeof args[i] === 'object' && args[i].rules != null){
                
                let checksum = 0
                for(let rule of args[i].rules){
                    if(rule.os != null){
                        if(rule.os.name === Library.mojangFriendlyOS()
                            && (rule.os.version == null || new RegExp(rule.os.version).test(os.release))){
                            if(rule.action === 'allow'){
                                checksum++
                            }
                        } else {
                            if(rule.action === 'disallow'){
                                checksum++
                            }
                        }
                    } else if(rule.features != null){
                        if(rule.features.has_custom_resolution != null && rule.features.has_custom_resolution === true){
                            if(ConfigManager.getFullscreen()){
                                args[i].value = [
                                    '--fullscreen',
                                    'true'
                                ]
                            }
                            checksum++
                        }
                    }
                }

                if(checksum === args[i].rules.length){
                    if(typeof args[i].value === 'string'){
                        args[i] = args[i].value
                    } else if(typeof args[i].value === 'object'){
                        args.splice(i, 1, ...args[i].value)
                    }

                    i--
                } else {
                    args[i] = null
                }

            } else if(typeof args[i] === 'string'){
                if(argDiscovery.test(args[i])){
                    const identifier = args[i].match(argDiscovery)[1]
                    let val = null
                    switch(identifier){
                        case 'auth_player_name':
                            val = this.authUser.displayName.trim()
                            break
                        case 'version_name':
                            val = this.server.getID()
                            break
                        case 'game_directory':
                            val = this.gameDir
                            break
                        case 'assets_root':
                            val = path.join(this.commonDir, 'assets')
                            break
                        case 'assets_index_name':
                            val = this.versionData.assets
                            break
                        case 'auth_uuid':
                            val = this.authUser.uuid.trim()
                            break
                        case 'auth_access_token':
                            val = this.authUser.accessToken
                            break
                        case 'user_type':
                            val = this.authUser.type === 'microsoft' ? 'msa' : 'mojang'
                            break
                        case 'version_type':
                            val = this.versionData.type
                            break
                        case 'resolution_width':
                            val = ConfigManager.getGameWidth()
                            break
                        case 'resolution_height':
                            val = ConfigManager.getGameHeight()
                            break
                        case 'natives_directory':
                            val = args[i].replace(argDiscovery, tempNativePath)
                            break
                        case 'launcher_name':
                            val = args[i].replace(argDiscovery, 'Ultra-Launcher')
                            break
                        case 'launcher_version':
                            val = args[i].replace(argDiscovery, this.launcherVersion)
                            break
                        case 'classpath':
                            val = this.classpathArg(mods, tempNativePath).join(process.platform === 'win32' ? ';' : ':')
                            break
                    }
                    if(val != null){
                        args[i] = val
                    }
                }
            }
        }

        let isAutoconnectBroken
        try {
            isAutoconnectBroken = Util.isAutoconnectBroken(this.forgeData.id.split('-')[2])
        } catch(err) {
            logger.error(err)
            logger.error('Forge version format changed.. assuming autoconnect works.')
            logger.debug('Forge version:', this.forgeData.id)
        }

        if(isAutoconnectBroken) {
            logger.error('Server autoconnect disabled on Forge 1.15.2 for builds earlier than 31.2.15 due to OpenGL Stack Overflow issue.')
            logger.error('Please upgrade your Forge version to at least 31.2.15!')
        } else {
            this._processAutoConnectArg(args)
        }

        args = args.concat(this.forgeData.arguments.game)

        args = args.filter(arg => {
            return arg != null
        })

        return args
    }

    /**
     * @returns {Array.<string>}
     **/
    _resolveForgeArgs(){
        const mcArgs = this.forgeData.minecraftArguments.split(' ')
        const argDiscovery = /\${*(.*)}/

        for(let i=0; i<mcArgs.length; ++i){
            if(argDiscovery.test(mcArgs[i])){
                const identifier = mcArgs[i].match(argDiscovery)[1]
                let val = null
                switch(identifier){
                    case 'auth_player_name':
                        val = this.authUser.displayName.trim()
                        break
                    case 'version_name':
                        val = this.server.getID()
                        break
                    case 'game_directory':
                        val = this.gameDir
                        break
                    case 'assets_root':
                        val = path.join(this.commonDir, 'assets')
                        break
                    case 'assets_index_name':
                        val = this.versionData.assets
                        break
                    case 'auth_uuid':
                        val = this.authUser.uuid.trim()
                        break
                    case 'auth_access_token':
                        val = this.authUser.accessToken
                        break
                    case 'user_type':
                        val = this.authUser.type === 'microsoft' ? 'msa' : 'mojang'
                        break
                    case 'user_properties':
                        val = '{}'
                        break
                    case 'version_type':
                        val = this.versionData.type
                        break
                }
                if(val != null){
                    mcArgs[i] = val
                }
            }
        }

        this._processAutoConnectArg(mcArgs)

        if(ConfigManager.getFullscreen()){
            mcArgs.push('--fullscreen')
            mcArgs.push(true)
        } else {
            mcArgs.push('--width')
            mcArgs.push(ConfigManager.getGameWidth())
            mcArgs.push('--height')
            mcArgs.push(ConfigManager.getGameHeight())
        }
        
        mcArgs.push('--modListFile')
        if(this._lteMinorVersion(9)) {
            mcArgs.push(path.basename(this.fmlDir))
        } else {
            mcArgs.push('absolute:' + this.fmlDir)
        }

        if(this.usingLiteLoader){
            mcArgs.push('--modRepo')
            mcArgs.push(this.llDir)

            mcArgs.unshift('com.mumfrey.liteloader.launch.LiteLoaderTweaker')
            mcArgs.unshift('--tweakClass')
        }

        return mcArgs
    }

    /**
     * @param {Array.<String>} list
     **/
    _processClassPathList(list) {

        const ext = '.jar'
        const extLen = ext.length
        for(let i=0; i<list.length; i++) {
            const extIndex = list[i].indexOf(ext)
            if(extIndex > -1 && extIndex  !== list[i].length - extLen) {
                list[i] = list[i].substring(0, extIndex + extLen)
            }
        }

    }

    /**
     * @param {Array.<Object>} mods
     * @param {string} tempNativePath
     * @returns {Array.<string>}
     **/
    classpathArg(mods, tempNativePath){
        let cpArgs = []

        const version = this.versionData.id
        cpArgs.push(path.join(this.commonDir, 'versions', version, version + '.jar'))

        if(this.usingLiteLoader){
            cpArgs.push(this.llPath)
        }

        const mojangLibs = this._resolveMojangLibraries(tempNativePath)

        const servLibs = this._resolveServerLibraries(mods)

        const finalLibs = {...mojangLibs, ...servLibs}
        cpArgs = cpArgs.concat(Object.values(finalLibs))

        this._processClassPathList(cpArgs)

        return cpArgs
    }

    /**
     * @param {string} tempNativePath
     * @returns {{[id: string]: string}}
     **/
    _resolveMojangLibraries(tempNativePath){
        const libs = {}

        const libArr = this.versionData.libraries
        fs.ensureDirSync(tempNativePath)
        for(let i=0; i<libArr.length; i++){
            const lib = libArr[i]
            if(Library.validateRules(lib.rules, lib.natives)){
                if(lib.natives == null){
                    const dlInfo = lib.downloads
                    const artifact = dlInfo.artifact
                    const to = path.join(this.libPath, artifact.path)
                    const versionIndependentId = lib.name.substring(0, lib.name.lastIndexOf(':'))
                    libs[versionIndependentId] = to
                } else {
                    const exclusionArr = lib.extract != null ? lib.extract.exclude : ['META-INF/']
                    const artifact = lib.downloads.classifiers[lib.natives[Library.mojangFriendlyOS()].replace('${arch}', process.arch.replace('x', ''))]
    
                    const to = path.join(this.libPath, artifact.path)
    
                    let zip = new AdmZip(to)
                    let zipEntries = zip.getEntries()
    
                    for(let i=0; i<zipEntries.length; i++){
                        const fileName = zipEntries[i].entryName
    
                        let shouldExclude = false

                        exclusionArr.forEach(function(exclusion){
                            if(fileName.indexOf(exclusion) > -1){
                                shouldExclude = true
                            }
                        })

                        if(!shouldExclude){
                            fs.writeFile(path.join(tempNativePath, fileName), zipEntries[i].getData(), (err) => {
                                if(err){
                                    logger.error('Error while extracting native library:', err)
                                }
                            })
                        }
    
                    }
                }
            }
        }

        return libs
    }

    /**
     * @param {Array.<Object>} mods
     * @returns {{[id: string]: string}}
     **/
    _resolveServerLibraries(mods){
        const mdls = this.server.getModules()
        let libs = {}

        for(let mdl of mdls){
            const type = mdl.getType()
            if(type === DistroManager.Types.ForgeHosted || type === DistroManager.Types.Library){
                libs[mdl.getVersionlessID()] = mdl.getArtifact().getPath()
                if(mdl.hasSubModules()){
                    const res = this._resolveModuleLibraries(mdl)
                    if(res.length > 0){
                        libs = {...libs, ...res}
                    }
                }
            }
        }

        for(let i=0; i<mods.length; i++){
            if(mods.sub_modules != null){
                const res = this._resolveModuleLibraries(mods[i])
                if(res.length > 0){
                    libs = {...libs, ...res}
                }
            }
        }

        return libs
    }

    /**
     * @param {Object} mdl
     * @returns {Array.<string>}
     **/
    _resolveModuleLibraries(mdl){
        if(!mdl.hasSubModules()){
            return []
        }
        let libs = []
        for(let sm of mdl.getSubModules()){
            if(sm.getType() === DistroManager.Types.Library){
                libs.push(sm.getArtifact().getPath())
            }
            if(mdl.hasSubModules()){
                const res = this._resolveModuleLibraries(sm)
                if(res.length > 0){
                    libs = libs.concat(res)
                }
            }
        }
        return libs
    }

}

module.exports = ProcessBuilder