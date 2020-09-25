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

  socket.on('user enter waiting-room', userName => {
    currUser = {
      userName,
      id: socket.id
    }

    connectedUsers_waiting.push(currUser)
    io.emit('refresh userlist_waiting', connectedUsers_waiting)
  })

  socket.on('disconnect', () => {
    console.log(connectedUsers_waiting)
    const indexOfUser = connectedUsers_waiting.findIndex(user => user.id === socket.id)
    console.log(indexOfUser)
    connectedUsers_waiting.splice(indexOfUser, 1)
    console.log(connectedUsers_waiting)
    socket.broadcast.emit('user leave waiting-room', connectedUsers_waiting)
  })
})
