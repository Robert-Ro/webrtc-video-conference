const path = require('path')
const fs = require('fs')
const express = require('express')
const app = express()
const socketIO = require('socket.io')
const https = require('https')

const privateKey = fs.readFileSync('./localhost+3-key.pem')
const certificate = fs.readFileSync('./localhost+3.pem')

const server = https.createServer({ key: privateKey, cert: certificate }, app)

const port = process.env.PORT || 18081
const env = process.env.NODE_ENV || 'development'

// Redirect to https
app.get('*', (req, res, next) => {
  if (req.headers['x-forwarded-proto'] !== 'https' && env !== 'development') {
    return res.redirect(['https://', req.get('Host'), req.url].join(''))
  }
  next()
})

app.use(express.static(path.join(__dirname, 'public')))
app.use(express.static(path.join(__dirname, 'node_modules')))

server.listen(port, () => {
  console.log(`listening on port ${port}`)
})

/**
 * Socket.io events
 */
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
})

io.sockets.on(
  'connection',
  /**
   *
   * @param {import('socket.io').Socket} 客户端 socket
   */
  function (socket) {
    /**
     * Log actions to the client
     * 输出日志
     */
    function log() {
      const array = ['Server:']
      array.push.apply(array, arguments)
      socket.emit('log', array)
    }

    /**
     * Handle message from a client
     * 处理来自客户端的消息
     * If toId is provided message will be sent ONLY to the client with that id 如果有toid，则发给指定的人
     * If toId is NOT provided and room IS provided message will be broadcast to that room，如果没toid，和房间号，则在房间内广播
     * If NONE is provided message will be sent to all clients，如果都没，则发给所有的客户端
     */
    socket.on('message', (message, toId = null, room = null) => {
      log('Client ' + socket.id + ' said: ', message)

      if (toId) {
        console.log('From ', socket.id, ' to ', toId, message.type)
        io.to(toId).emit('message', message, socket.id)
      } else if (room) {
        console.log('From ', socket.id, ' to room: ', room, message.type)
        // 发送给除了当前socket（发送消息的客户端）之外的房间内的所有客户端。
        socket.broadcast.to(room).emit('message', message, socket.id)
        // socket.to(room).emit() 将向房间内的所有客户端发送消息，包括当前socket
      } else {
        console.log('From ', socket.id, ' to everyone ', message.type)
        socket.broadcast.emit('message', message, socket.id)
      }
    })

    let roomAdmin // save admins socket id (will get overwritten if new room gets created)

    /**
     * When room gets created or someone joins it
     */
    socket.on('create or join', (room) => {
      log('Create or Join room: ' + room)

      // Get number of clients in the room
      const clientsInRoom = io.sockets.adapter.rooms.get(room)
      let numClients = clientsInRoom ? clientsInRoom.size : 0

      if (numClients === 0) {
        // Create room
        socket.join(room)
        roomAdmin = socket.id
        socket.emit('created', room, socket.id)
      } else {
        log('Client ' + socket.id + ' joined room ' + room)

        // Join room
        io.sockets.in(room).emit('join', room) // Notify users in room
        socket.join(room)
        io.to(socket.id).emit('joined', room, socket.id) // Notify client that they joined a room
        io.sockets.in(room).emit('ready', socket.id) // Room is ready for creating connections
      }
    })

    /**
     * Kick participant from a call
     */
    socket.on('kickout', (socketId, room) => {
      if (socket.id === roomAdmin) {
        socket.broadcast.emit('kickout', socketId)
        io.sockets.sockets.get(socketId).leave(room)
      } else {
        console.log('not an admin')
      }
    })

    // participant leaves room
    socket.on('leave room', (room) => {
      socket.leave(room)
      socket.emit('left room', room)
      socket.broadcast.to(room).emit('message', { type: 'leave' }, socket.id)
    })

    /**
     * When participant leaves notify other participants
     */
    socket.on('disconnecting', () => {
      socket.rooms.forEach((room) => {
        if (room === socket.id) return
        socket.broadcast.to(room).emit('message', { type: 'leave' }, socket.id)
      })
    })
  }
)
