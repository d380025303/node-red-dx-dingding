'use strict';
const BATCH_SEND_URL = "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend"
const ROBOT_DOWNLOAD_URL = "https://api.dingtalk.com/v1.0/robot/messageFiles/download"

module.exports = function (RED) {
    const { DWClient, TOPIC_ROBOT } = require('dingtalk-stream');
    const axios = require('axios');

    RED.nodes.registerType('ddConfig', function (n) {
        const node = this;
        RED.nodes.createNode(node, n);
        this.clientId = n.clientId
        this.clientSecret = n.clientSecret
        this.robotCode = n.robotCode
        this.client = new DWClient({
            clientId: n.clientId,
            clientSecret: n.clientSecret,
            keepAlive: true,
        });
    });

    RED.nodes.registerType('ddMsgIn', function (config) {
        const node = this;
        RED.nodes.createNode(node, config);
        const ddConfig = RED.nodes.getNode(config.ddConfig)
        const client = ddConfig.client

        client.registerCallbackListener(TOPIC_ROBOT, async (res) => {
            const data = JSON.parse(res.data)
            let msg = {
                ddSource: {
                    headers: res.headers,
                    data: data
                },
                ddMsgType: data.msgtype
            }
            let payload;
            if (data.msgtype === 'text') {
                payload = data.text.content
            } else if (data.msgtype === 'picture') {
                const accessToken = await client.getAccessToken()
                let response = await axios({
                    url: ROBOT_DOWNLOAD_URL,
                    method: "POST",
                    responseType: "json",
                    data: {
                        "downloadCode" : data.content.downloadCode,
                        "robotCode" : data.robotCode,
                    },
                    headers: {
                        "Content-Type": "application/json",
                        "Host": "api.dingtalk.com",
                        "x-acs-dingtalk-access-token": accessToken,
                    }
                });
                const downloadUrl = response.data.downloadUrl
                // node.log(JSON.stringify(response.data))
                response = await axios({
                    url: downloadUrl,
                    method: "GET",
                    responseType: "arraybuffer",
                });
                payload = Buffer.from(response.data, 'binary');
                msg.ddDownloadUrl = downloadUrl
            } else {
                payload = data
            }
            msg.payload = payload
            node.send(msg)
            client.socketCallBackResponse(res.headers.messageId, '');
        }).connect();

        let isAlive = false
        setInterval(async function () {
            const nowIsAlive = client.isAlive
            if (isAlive !== nowIsAlive) {
                node.status({
                    fill: nowIsAlive ? "green" : "red",
                    shape:"ring",
                    text: nowIsAlive ? RED._('dd.conn.connect') : RED._('dd.conn.disconnect')
                });
            }
            if (!nowIsAlive || !isAlive) {
                node.log('nowIsAlive...........')
                client.disconnect()
                await client.connect()
            }
            isAlive = nowIsAlive
        }, 5000);
    });

    RED.nodes.registerType('ddMsgResponse', function (config) {
        const node = this;
        RED.nodes.createNode(node, config);
        node.on('input', async (msg, send, done) => {
            const ddSource = msg.ddSource
            const ddMsgType = msg.ddMsgType
            const payload = msg.payload
            let v
            if (ddMsgType === 'text') {
                v = {
                    content: payload
                }
            } else {
                v = payload
            }
            let req = {
                at: {
                    "atUserIds": [ddSource.data.senderStaffId]
                },
                msgtype: ddMsgType,
                [ddMsgType]: v
            }
            // node.log(ddSource.data.sessionWebhook)
            await axios({
                url: ddSource.data.sessionWebhook,
                method: "POST",
                responseType: "json",
                data: req,
                headers: {
                    Accept: "application/json"
                }
            });
            if (done) {
                done();
            }
        });
    });

    RED.nodes.registerType('ddTextMsg', function (config) {
        const node = this;
        RED.nodes.createNode(node, config);
        const ddConfig = RED.nodes.getNode(config.ddConfig)
        const client = ddConfig.client
        const robotCode = ddConfig.robotCode
        const cUserIds = config.userIds
        const content = config.content

        node.on('input', async (msg, send, done) => {
            const ddUserIds = msg.ddUserIds
            const payload = msg.payload
            let v = {
                content: content || payload
            }
            let userIds = ddUserIds || cUserIds
            const accessToken = await client.getAccessToken()
            let req = {
                robotCode: robotCode,
                userIds: userIds.split(","),
                msgKey: 'sampleText',
                msgParam: JSON.stringify(v)
            }
            await axios({
                url: BATCH_SEND_URL,
                method: "POST",
                responseType: "json",
                data: req,
                headers: {
                    "Content-Type": "application/json",
                    "Host": "api.dingtalk.com",
                    "x-acs-dingtalk-access-token": accessToken,
                }
            });
            if (done) {
                done();
            }
        });
    });

};
