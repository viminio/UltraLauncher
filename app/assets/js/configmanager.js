const fs   = require('fs-extra')
const os   = require('os')
const path = require('path')

const logger = require('./loggerutil')('%c[ConfigManager]', 'color: #a02d2a; font-weight: bold')

const sysRoot = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME)
const dataPath = path.join(sysRoot, '.ultralauncher')

const launcherDir = process.env.CONFIG_DIRECT_PATH || require('@electron/remote').app.getPath('userData')

/**
 * @returns {string}
 **/
exports.getLauncherDirectory = function(){
    return launcherDir
}

/**
 * @returns {string}
 **/
exports.getDataDirectory = function(def = false){
    return !def ? config.settings.launcher.dataDirectory : DEFAULT_CONFIG.settings.launcher.dataDirectory
}

/**
 * @param {string} dataDirectory
 **/
exports.setDataDirectory = function(dataDirectory){
    config.settings.launcher.dataDirectory = dataDirectory
}

const configPath = path.join(exports.getLauncherDirectory(), 'config.json')
const configPathLEGACY = path.join(dataPath, 'config.json')
const firstLaunch = !fs.existsSync(configPath) && !fs.existsSync(configPathLEGACY)

exports.getAbsoluteMinRAM = function(){
    const mem = os.totalmem()
    return mem >= 6000000000 ? 3 : 2
}

exports.getAbsoluteMaxRAM = function(){
    const mem = os.totalmem()
    const gT16 = mem-16000000000
    return Math.floor((mem-1000000000-(gT16 > 0 ? (Number.parseInt(gT16/8) + 16000000000/4) : mem/4))/1000000000)
}

function resolveMaxRAM(){
    const mem = os.totalmem()
    return mem >= 8000000000 ? '4G' : (mem >= 6000000000 ? '3G' : '2G')
}

function resolveMinRAM(){
    return resolveMaxRAM()
}


const DEFAULT_CONFIG = {
    settings: {
        java: {
            minRAM: resolveMinRAM(),
            maxRAM: resolveMaxRAM(),
            executable: null,
            jvmOptions: [
                '-XX:+UseConcMarkSweepGC',
                '-XX:+CMSIncrementalMode',
                '-XX:-UseAdaptiveSizePolicy',
                '-Xmn128M'
            ],
        },
        game: {
            resWidth: 1280,
            resHeight: 720,
            fullscreen: false,
            autoConnect: true,
            launchDetached: true
        },
        launcher: {
            allowPrerelease: false,
            dataDirectory: dataPath
        }
    },
    newsCache: {
        date: null,
        content: null,
        dismissed: false
    },
    clientToken: null,
    selectedServer: null,
    selectedAccount: null,
    authenticationDatabase: {},
    modConfigurations: []
}

let config = null

exports.save = function(){
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'UTF-8')
}


exports.load = function(){
    let doLoad = true

    if(!fs.existsSync(configPath)){
        fs.ensureDirSync(path.join(configPath, '..'))
        if(fs.existsSync(configPathLEGACY)){
            fs.moveSync(configPathLEGACY, configPath)
        } else {
            doLoad = false
            config = DEFAULT_CONFIG
            exports.save()
        }
    }
    if(doLoad){
        let doValidate = false
        try {
            config = JSON.parse(fs.readFileSync(configPath, 'UTF-8'))
            doValidate = true
        } catch (err){
            logger.error(err)
            logger.log('Configuration file contains malformed JSON or is corrupt.')
            logger.log('Generating a new configuration file.')
            fs.ensureDirSync(path.join(configPath, '..'))
            config = DEFAULT_CONFIG
            exports.save()
        }
        if(doValidate){
            config = validateKeySet(DEFAULT_CONFIG, config)
            exports.save()
        }
    }
    logger.log('Successfully Loaded')
}

/**
 * @returns {boolean}
 **/
exports.isLoaded = function(){
    return config != null
}

/**
 * @param {Object} srcObj
 * @param {Object} destObj
 * @returns {Object}
 **/
function validateKeySet(srcObj, destObj){
    if(srcObj == null){
        srcObj = {}
    }
    const validationBlacklist = ['authenticationDatabase']
    const keys = Object.keys(srcObj)
    for(let i=0; i<keys.length; i++){
        if(typeof destObj[keys[i]] === 'undefined'){
            destObj[keys[i]] = srcObj[keys[i]]
        } else if(typeof srcObj[keys[i]] === 'object' && srcObj[keys[i]] != null && !(srcObj[keys[i]] instanceof Array) && validationBlacklist.indexOf(keys[i]) === -1){
            destObj[keys[i]] = validateKeySet(srcObj[keys[i]], destObj[keys[i]])
        }
    }
    return destObj
}

/**
 * @returns {boolean}
 **/
exports.isFirstLaunch = function(){
    return firstLaunch
}

/**
 * @returns {string}
 **/
exports.getTempNativeFolder = function(){
    return 'WCNatives'
}

/**
 * @returns {Object}
 **/
exports.getNewsCache = function(){
    return config.newsCache
}

/**
 * @param {Object} newsCache
 **/
exports.setNewsCache = function(newsCache){
    config.newsCache = newsCache
}

/**
 * @param {boolean} dismissed
 **/
exports.setNewsCacheDismissed = function(dismissed){
    config.newsCache.dismissed = dismissed
}

/**
 * @returns {string}
 **/
exports.getCommonDirectory = function(){
    return path.join(exports.getDataDirectory(), 'common')
}

/**
 * @returns {string}
 **/
exports.getInstanceDirectory = function(){
    return path.join(exports.getDataDirectory(), 'instances')
}

/**
 * @returns {string}
 **/
exports.getClientToken = function(){
    return config.clientToken
}

/**
 * @param {string} clientToken
 **/
exports.setClientToken = function(clientToken){
    config.clientToken = clientToken
}

/**
 * @param {boolean} def
 * @returns {string}
 **/
exports.getSelectedServer = function(def = false){
    return !def ? config.selectedServer : DEFAULT_CONFIG.clientToken
}

/**
 * @param {string} serverID
 **/
exports.setSelectedServer = function(serverID){
    config.selectedServer = serverID
}

/**
 * @returns {Array.<Object>}
 **/
exports.getAuthAccounts = function(){
    return config.authenticationDatabase
}

/**
 * @param {string} uuid
 * @returns {Object}
 **/
exports.getAuthAccount = function(uuid){
    return config.authenticationDatabase[uuid]
}

/**
 * @param {string} uuid
 * @param {string} accessToken
 * @returns {Object}
 **/
exports.updateMojangAuthAccount = function(uuid, accessToken){
    config.authenticationDatabase[uuid].accessToken = accessToken
    config.authenticationDatabase[uuid].type = 'mojang'
    return config.authenticationDatabase[uuid]
}

/**
 * @param {string} uuid
 * @param {string} accessToken
 * @param {string} username
 * @param {string} displayName
 * @returns {Object}
 **/
exports.addMojangAuthAccount = function(uuid, accessToken, username, displayName){
    config.selectedAccount = uuid
    config.authenticationDatabase[uuid] = {
        type: 'mojang',
        accessToken,
        username: username.trim(),
        uuid: uuid.trim(),
        displayName: displayName.trim()
    }
    return config.authenticationDatabase[uuid]
}

/**
 * @param {string} uuid
 * @param {string} accessToken
 * @param {string} msAccessToken
 * @param {string} msRefreshToken
 * @param {date} msExpires
 * @param {date} mcExpires
 * @returns {Object}
 **/
exports.updateMicrosoftAuthAccount = function(uuid, accessToken, msAccessToken, msRefreshToken, msExpires, mcExpires) {
    config.authenticationDatabase[uuid].accessToken = accessToken
    config.authenticationDatabase[uuid].expiresAt = mcExpires
    config.authenticationDatabase[uuid].microsoft.access_token = msAccessToken
    config.authenticationDatabase[uuid].microsoft.refresh_token = msRefreshToken
    config.authenticationDatabase[uuid].microsoft.expires_at = msExpires
    return config.authenticationDatabase[uuid]
}

/**
 * @param {string} uuid
 * @param {string} accessToken
 * @param {string} name
 * @param {date} mcExpires
 * @param {string} msAccessToken
 * @param {string} msRefreshToken
 * @param {date} msExpires
 * @returns {Object}
 **/
exports.addMicrosoftAuthAccount = function(uuid, accessToken, name, mcExpires, msAccessToken, msRefreshToken, msExpires) {
    config.selectedAccount = uuid
    config.authenticationDatabase[uuid] = {
        type: 'microsoft',
        accessToken,
        username: name.trim(),
        uuid: uuid.trim(),
        displayName: name.trim(),
        expiresAt: mcExpires,
        microsoft: {
            access_token: msAccessToken,
            refresh_token: msRefreshToken,
            expires_at: msExpires
        }
    }
    return config.authenticationDatabase[uuid]
}

/**
 * @param {string} uuid
 * @returns {boolean}
 **/
exports.removeAuthAccount = function(uuid){
    if(config.authenticationDatabase[uuid] != null){
        delete config.authenticationDatabase[uuid]
        if(config.selectedAccount === uuid){
            const keys = Object.keys(config.authenticationDatabase)
            if(keys.length > 0){
                config.selectedAccount = keys[0]
            } else {
                config.selectedAccount = null
                config.clientToken = null
            }
        }
        return true
    }
    return false
}

/**
 * @returns {Object}
 **/
exports.getSelectedAccount = function(){
    return config.authenticationDatabase[config.selectedAccount]
}

/**
 * @param {string} uuid
 * @returns {Object}
 **/
exports.setSelectedAccount = function(uuid){
    const authAcc = config.authenticationDatabase[uuid]
    if(authAcc != null) {
        config.selectedAccount = uuid
    }
    return authAcc
}

/**
 * @returns {Array.<Object>}
 **/
exports.getModConfigurations = function(){
    return config.modConfigurations
}

/**
 * @param {Array.<Object>} configurations
 **/
exports.setModConfigurations = function(configurations){
    config.modConfigurations = configurations
}

/**
 * @param {string} serverid
 * @returns {Object}
 **/
exports.getModConfiguration = function(serverid){
    const cfgs = config.modConfigurations
    for(let i=0; i<cfgs.length; i++){
        if(cfgs[i].id === serverid){
            return cfgs[i]
        }
    }
    return null
}

/**
 * @param {string} serverid
 * @param {Object} configuration
 **/
exports.setModConfiguration = function(serverid, configuration){
    const cfgs = config.modConfigurations
    for(let i=0; i<cfgs.length; i++){
        if(cfgs[i].id === serverid){
            cfgs[i] = configuration
            return
        }
    }
    cfgs.push(configuration)
}

/**
 * @param {boolean} def
 * @returns {string}
 **/
exports.getMinRAM = function(def = false){
    return !def ? config.settings.java.minRAM : DEFAULT_CONFIG.settings.java.minRAM
}

/**
 * @param {string} minRAM
 **/
exports.setMinRAM = function(minRAM){
    config.settings.java.minRAM = minRAM
}

/**
 * @param {boolean} def
 * @returns {string}
 **/
exports.getMaxRAM = function(def = false){
    return !def ? config.settings.java.maxRAM : resolveMaxRAM()
}

/**
 * @param {string} maxRAM
 **/
exports.setMaxRAM = function(maxRAM){
    config.settings.java.maxRAM = maxRAM
}

/**
 * @returns {string}
 **/
exports.getJavaExecutable = function(){
    return config.settings.java.executable
}

/**
 * @param {string} executable
 **/
exports.setJavaExecutable = function(executable){
    config.settings.java.executable = executable
}

/**
 * @param {boolean} def
 * @returns {Array.<string>}
 **/
exports.getJVMOptions = function(def = false){
    return !def ? config.settings.java.jvmOptions : DEFAULT_CONFIG.settings.java.jvmOptions
}

/**
 * @param {Array.<string>} jvmOptions
 **/
exports.setJVMOptions = function(jvmOptions){
    config.settings.java.jvmOptions = jvmOptions
}

/**
 * @param {boolean} def
 * @returns {number}
 **/
exports.getGameWidth = function(def = false){
    return !def ? config.settings.game.resWidth : DEFAULT_CONFIG.settings.game.resWidth
}

/**
 * @param {number} resWidth
 **/
exports.setGameWidth = function(resWidth){
    config.settings.game.resWidth = Number.parseInt(resWidth)
}

/**
 * @param {number} resWidth
 * @returns {boolean}
 **/
exports.validateGameWidth = function(resWidth){
    const nVal = Number.parseInt(resWidth)
    return Number.isInteger(nVal) && nVal >= 0
}

/**
 * @param {boolean} def
 * @returns {number}
 **/
exports.getGameHeight = function(def = false){
    return !def ? config.settings.game.resHeight : DEFAULT_CONFIG.settings.game.resHeight
}

/**
 * @param {number} resHeight
 **/
exports.setGameHeight = function(resHeight){
    config.settings.game.resHeight = Number.parseInt(resHeight)
}

/**
 * @param {number} resHeight
 * @returns {boolean}
 **/
exports.validateGameHeight = function(resHeight){
    const nVal = Number.parseInt(resHeight)
    return Number.isInteger(nVal) && nVal >= 0
}

/**
 * @param {boolean} def
 * @returns {boolean}
 **/
exports.getFullscreen = function(def = false){
    return !def ? config.settings.game.fullscreen : DEFAULT_CONFIG.settings.game.fullscreen
}

/**
 * @param {boolean} fullscreen
 **/
exports.setFullscreen = function(fullscreen){
    config.settings.game.fullscreen = fullscreen
}

/**
 * @param {boolean} def
 * @returns {boolean}
 **/
exports.getAutoConnect = function(def = false){
    return !def ? config.settings.game.autoConnect : DEFAULT_CONFIG.settings.game.autoConnect
}

/**
 * @param {boolean} autoConnect 
 **/
exports.setAutoConnect = function(autoConnect){
    config.settings.game.autoConnect = autoConnect
}

/**
 * @param {boolean} def
 * @returns {boolean}
 **/
exports.getLaunchDetached = function(def = false){
    return !def ? config.settings.game.launchDetached : DEFAULT_CONFIG.settings.game.launchDetached
}

/**
 * @param {boolean} launchDetached
 **/
exports.setLaunchDetached = function(launchDetached){
    config.settings.game.launchDetached = launchDetached
}

/**
 * @param {boolean} def
 * @returns {boolean}
 **/
exports.getAllowPrerelease = function(def = false){
    return !def ? config.settings.launcher.allowPrerelease : DEFAULT_CONFIG.settings.launcher.allowPrerelease
}

/**
 * @param {boolean} launchDetached 
 **/
exports.setAllowPrerelease = function(allowPrerelease){
    config.settings.launcher.allowPrerelease = allowPrerelease
}