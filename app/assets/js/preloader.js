const {ipcRenderer} = require('electron')
const fs            = require('fs-extra')
const os            = require('os')
const path          = require('path')

const ConfigManager = require('./configmanager')
const DistroManager = require('./distromanager')
const LangLoader    = require('./langloader')
const logger        = require('./loggerutil')('%c[Preloader]', 'color: #a02d2a; font-weight: bold')

logger.log('Loading..')
ConfigManager.load()
LangLoader.loadLanguage('en_US')

function onDistroLoad(data){
    if(data != null){

        if(ConfigManager.getSelectedServer() == null || data.getServer(ConfigManager.getSelectedServer()) == null){
            logger.log('Determining default selected server..')
            ConfigManager.setSelectedServer(data.getMainServer().getID())
            ConfigManager.save()
        }
    }
    ipcRenderer.send('distributionIndexDone', data != null)
}

DistroManager.pullRemote().then((data) => {
    logger.log('Loaded distribution index.')

    onDistroLoad(data)

}).catch((err) => {
    logger.log('Failed to load distribution index.')
    logger.error(err)

    logger.log('Attempting to load an older version of the distribution index.')
    DistroManager.pullLocal().then((data) => {
        logger.log('Successfully loaded an older version of the distribution index.')

        onDistroLoad(data)


    }).catch((err) => {

        logger.log('Failed to load an older version of the distribution index.')
        logger.log('Application cannot run.')
        logger.error(err)

        onDistroLoad(null)

    })

})

fs.remove(path.join(os.tmpdir(), ConfigManager.getTempNativeFolder()), (err) => {
    if(err){
        logger.warn('Error while cleaning natives directory', err)
    } else {
        logger.log('Cleaned natives directory.')
    }
})