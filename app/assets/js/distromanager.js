const fs = require('fs')
const path = require('path')
const request = require('request')

const ConfigManager = require('./configmanager')
const logger        = require('./loggerutil')('%c[DistroManager]', 'color: #a02d2a; font-weight: bold')

class Artifact {
    
    /**
     * @param {Object} json 
     * @returns {Artifact}
     **/
    static fromJSON(json){
        return Object.assign(new Artifact(), json)
    }

    /**
     * @returns {string}
     **/
    getHash(){
        return this.MD5
    }

    /**
     * @returns {number}
     **/
    getSize(){
        return this.size
    }

    /**
     * @returns {string}
     **/
    getURL(){
        return this.url
    }

    /**
     * @returns {string}
     **/
    getPath(){
        return this.path
    }

}
exports.Artifact

class Required {
    
    /**
     * @param {Object} json
     * @returns {Required}
     **/
    static fromJSON(json){
        if(json == null){
            return new Required(true, true)
        } else {
            return new Required(json.value == null ? true : json.value, json.def == null ? true : json.def)
        }
    }

    constructor(value, def){
        this.value = value
        this.default = def
    }

    /**
     * @returns {boolean}
     **/
    isDefault(){
        return this.default
    }

    /**
     * @returns {boolean}
     **/
    isRequired(){
        return this.value
    }

}
exports.Required

class Module {

    /**
     * @param {Object} json
     * @param {string} serverid
     * @returns {Module}
     **/
    static fromJSON(json, serverid){
        return new Module(json.id, json.name, json.type, json.required, json.artifact, json.subModules, serverid)
    }

    /**
     * @param {string} type
     * @return {string}
     **/
    static _resolveDefaultExtension(type){
        switch (type) {
            case exports.Types.Library:
            case exports.Types.ForgeHosted:
            case exports.Types.LiteLoader:
            case exports.Types.ForgeMod:
                return 'jar'
            case exports.Types.LiteMod:
                return 'litemod'
            case exports.Types.File:
            default:
                return 'jar'
        }
    }

    constructor(id, name, type, required, artifact, subModules, serverid) {
        this.identifier = id
        this.type = type
        this._resolveMetaData()
        this.name = name
        this.required = Required.fromJSON(required)
        this.artifact = Artifact.fromJSON(artifact)
        this._resolveArtifactPath(artifact.path, serverid)
        this._resolveSubModules(subModules, serverid)
    }

    _resolveMetaData(){
        try {

            const m0 = this.identifier.split('@')

            this.artifactExt = m0[1] || Module._resolveDefaultExtension(this.type)

            const m1 = m0[0].split(':')

            this.artifactClassifier = m1[3] || undefined
            this.artifactVersion = m1[2] || '???'
            this.artifactID = m1[1] || '???'
            this.artifactGroup = m1[0] || '???'

        } catch (err) {
            logger.error('Improper ID for module', this.identifier, err)
        }
    }

    _resolveArtifactPath(artifactPath, serverid){
        const pth = artifactPath == null ? path.join(...this.getGroup().split('.'), this.getID(), this.getVersion(), `${this.getID()}-${this.getVersion()}${this.artifactClassifier != undefined ? `-${this.artifactClassifier}` : ''}.${this.getExtension()}`) : artifactPath

        switch (this.type){
            case exports.Types.Library:
            case exports.Types.ForgeHosted:
            case exports.Types.LiteLoader:
                this.artifact.path = path.join(ConfigManager.getCommonDirectory(), 'libraries', pth)
                break
            case exports.Types.ForgeMod:
            case exports.Types.LiteMod:
                this.artifact.path = path.join(ConfigManager.getCommonDirectory(), 'modstore', pth)
                break
            case exports.Types.VersionManifest:
                this.artifact.path = path.join(ConfigManager.getCommonDirectory(), 'versions', this.getIdentifier(), `${this.getIdentifier()}.json`)
                break
            case exports.Types.File:
            default:
                this.artifact.path = path.join(ConfigManager.getInstanceDirectory(), serverid, pth)
                break
        }

    }

    _resolveSubModules(json, serverid){
        const arr = []
        if(json != null){
            for(let sm of json){
                arr.push(Module.fromJSON(sm, serverid))
            }
        }
        this.subModules = arr.length > 0 ? arr : null
    }

    /**
     * @returns {string}
     **/
    getIdentifier(){
        return this.identifier
    }

    /**
     * @returns {string}
     **/
    getName(){
        return this.name
    }

    /**
     * @returns {Required}
     **/
    getRequired(){
        return this.required
    }

    /**
     * @returns {Artifact}
     **/
    getArtifact(){
        return this.artifact
    }

    /**
     * @returns {string}
     **/
    getID(){
        return this.artifactID
    }

    /**
     * @returns {string}
     **/
    getGroup(){
        return this.artifactGroup
    }

    /**
     * @returns {string}
     **/
    getVersionlessID(){
        return this.getGroup() + ':' + this.getID()
    }

    /**
     * @returns {string}
     **/
    getExtensionlessID(){
        return this.getIdentifier().split('@')[0]
    }

    /**
     * @returns {string}
     **/
    getVersion(){
        return this.artifactVersion
    }

    /**
     * @returns {string}
     **/
    getClassifier(){
        return this.artifactClassifier
    }

    /**
     * @returns {string}
     **/
    getExtension(){
        return this.artifactExt
    }

    /**
     * @returns {boolean}
     **/
    hasSubModules(){
        return this.subModules != null
    }

    /**
     * @returns {Array.<Module>}
     **/
    getSubModules(){
        return this.subModules
    }

    /**
     * @returns {string}
     **/
    getType(){
        return this.type
    }

}
exports.Module

class Server {

    /**
     * @param {Object} json
     * @returns {Server}
     **/
    static fromJSON(json){

        const mdls = json.modules
        json.modules = []

        const serv = Object.assign(new Server(), json)
        serv._resolveModules(mdls)

        return serv
    }

    _resolveModules(json){
        const arr = []
        for(let m of json){
            arr.push(Module.fromJSON(m, this.getID()))
        }
        this.modules = arr
    }

    /**
     * @returns {string}
     **/
    getID(){
        return this.id
    }

    /**
     * @returns {string}
     **/
    getName(){
        return this.name
    }

    /**
     * @returns {string}
     **/
    getDescription(){
        return this.description
    }

    /**
     * @returns {string}
     **/
    getIcon(){
        return this.icon
    }

    /**
     * @returns {string}
     **/
    getVersion(){
        return this.version
    }

    /**
     * @returns {string}
     **/
    getAddress(){
        return this.address
    }

    /**
     * @returns {string}
     **/
    getMinecraftVersion(){
        return this.minecraftVersion
    }

    /**
     * @returns {boolean}
     **/
    isMainServer(){
        return this.mainServer
    }

    /**
     * @returns {boolean}
     **/
    isAutoConnect(){
        return this.autoconnect
    }

    /**
     * @returns {Array.<Module>}
     **/
    getModules(){
        return this.modules
    }

}
exports.Server

class DistroIndex {

    /**
     * @param {Object} json
     * @returns {DistroIndex}
     **/
    static fromJSON(json){

        const servers = json.servers
        json.servers = []

        const distro = Object.assign(new DistroIndex(), json)
        distro._resolveServers(servers)
        distro._resolveMainServer()

        return distro
    }

    _resolveServers(json){
        const arr = []
        for(let s of json){
            arr.push(Server.fromJSON(s))
        }
        this.servers = arr
    }

    _resolveMainServer(){

        for(let serv of this.servers){
            if(serv.mainServer){
                this.mainServer = serv.id
                return
            }
        }

        this.mainServer = (this.servers.length > 0) ? this.servers[0].getID() : null
    }

    /**
     * @returns {string}
     **/
    getVersion(){
        return this.version
    }

    /**
     * @returns {string}
     **/
    getRSS(){
        return this.rss
    }

    /**
     * @returns {Array.<Server>}
     **/
    getServers(){
        return this.servers
    }

    /**
     * @param {string} id
     * @returns {Server}
     **/
    getServer(id){
        for(let serv of this.servers){
            if(serv.id === id){
                return serv
            }
        }
        return null
    }

    /**
     * @returns {Server}
     **/
    getMainServer(){
        return this.mainServer != null ? this.getServer(this.mainServer) : null
    }

}
exports.DistroIndex

exports.Types = {
    Library: 'Library',
    ForgeHosted: 'ForgeHosted',
    Forge: 'Forge',
    LiteLoader: 'LiteLoader',
    ForgeMod: 'ForgeMod',
    LiteMod: 'LiteMod',
    File: 'File',
    VersionManifest: 'VersionManifest'
}

let DEV_MODE = false

const DISTRO_PATH = path.join(ConfigManager.getLauncherDirectory(), 'distribution.json')
const DEV_PATH = path.join(ConfigManager.getLauncherDirectory(), 'dev_distribution.json')

let data = null

/**
 * @returns {Promise.<DistroIndex>}
 **/
exports.pullRemote = function(){
    if(DEV_MODE){
        return exports.pullLocal()
    }
    return new Promise((resolve, reject) => {
        const distroURL = 'http://mc.westeroscraft.com/WesterosCraftLauncher/distribution.json'
        const opts = {
            url: distroURL,
            timeout: 2500
        }
        const distroDest = path.join(ConfigManager.getLauncherDirectory(), 'distribution.json')
        request(opts, (error, resp, body) => {
            if(!error){
                
                try {
                    data = DistroIndex.fromJSON(JSON.parse(body))
                } catch (e) {
                    reject(e)
                    return
                }

                fs.writeFile(distroDest, body, 'utf-8', (err) => {
                    if(!err){
                        resolve(data)
                        return
                    } else {
                        reject(err)
                        return
                    }
                })
            } else {
                reject(error)
                return
            }
        })
    })
}

/**
 * @returns {Promise.<DistroIndex>}
 **/
exports.pullLocal = function(){
    return new Promise((resolve, reject) => {
        fs.readFile(DEV_MODE ? DEV_PATH : DISTRO_PATH, 'utf-8', (err, d) => {
            if(!err){
                data = DistroIndex.fromJSON(JSON.parse(d))
                resolve(data)
                return
            } else {
                reject(err)
                return
            }
        })
    })
}

exports.setDevMode = function(value){
    if(value){
        logger.log('Developer mode enabled.')
        logger.log('If you don\'t know what that means, revert immediately.')
    } else {
        logger.log('Developer mode disabled.')
    }
    DEV_MODE = value
}

exports.isDevMode = function(){
    return DEV_MODE
}

/**
 * @returns {DistroIndex}
 **/
exports.getDistribution = function(){
    return data
}