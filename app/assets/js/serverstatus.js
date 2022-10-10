const net = require('net')

/**
 * @param {string} address
 * @param {number} port
 * @returns {Promise.<Object>}
 **/
exports.getStatus = function(address, port = 25565){

    if(port == null || port == ''){
        port = 25565
    }
    if(typeof port === 'string'){
        port = parseInt(port)
    }

    return new Promise((resolve, reject) => {
        const socket = net.connect(port, address, () => {
            let buff = Buffer.from([0xFE, 0x01])
            socket.write(buff)
        })

        socket.setTimeout(2500, () => {
            socket.end()
            reject({
                code: 'ETIMEDOUT',
                errno: 'ETIMEDOUT',
                address,
                port
            })
        })

        socket.on('data', (data) => {
            if(data != null && data != ''){
                let server_info = data.toString().split('\x00\x00\x00')
                const NUM_FIELDS = 6
                if(server_info != null && server_info.length >= NUM_FIELDS){
                    resolve({
                        online: true,
                        version: server_info[2].replace(/\u0000/g, ''),
                        motd: server_info[3].replace(/\u0000/g, ''),
                        onlinePlayers: server_info[4].replace(/\u0000/g, ''),
                        maxPlayers: server_info[5].replace(/\u0000/g,'')
                    })
                } else {
                    resolve({
                        online: false
                    })
                }
            }
            socket.end()
        })

        socket.on('error', (err) => {
            socket.destroy()
            reject(err)
        })
    })

}