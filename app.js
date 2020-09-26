const express = require("express")
const app = express()

const server = require("http").createServer(app)
const io = require("socket.io")(server)

const port = process.env.PORT || 5000

var connectedUsers_waiting = []

server.listen(port, () => console.log(`Server running on ${port}`))

io.on("connect", socket => {
  let currUser
  console.log(`User(${socket.id}) connected`)

  // Sends user socket id to the client when the connection established
  socket.emit('user connect', socket.id)

  // User etners waiting room
  socket.on('user enter waiting-room', userName => {
    currUser = {
      userName,
      id: socket.id
    }

    connectedUsers_waiting.push(currUser)
    io.emit('refresh userlist_waiting', connectedUsers_waiting)
  })

  // User leaves waiting room
  socket.on('user leave waiting-room', () => {
    const indexOfUser = connectedUsers_waiting.findIndex(user => user.id === socket.id)
    console.log(connectedUsers_waiting)
    console.log(socket.id)
    console.log(indexOfUser)
    if (indexOfUser > -1) {
      connectedUsers_waiting.splice(indexOfUser, 1)
    }

    socket.broadcast.emit('refresh userlist_waiting', connectedUsers_waiting)
  })

  // User disconnects
  socket.on('disconnect', () => {
    const indexOfUser = connectedUsers_waiting.findIndex(user => user.id === socket.id)
    if (indexOfUser > -1) {
      connectedUsers_waiting.splice(indexOfUser, 1)
    }
    socket.broadcast.emit('refresh userlist_waiting', connectedUsers_waiting)
  })
})
 