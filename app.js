const { Console } = require("console")
const express = require("express")
const { join } = require("path")
const app = express()

const server = require("http").createServer(app)
const io = require("socket.io")(server)

const port = process.env.PORT || 5000

server.listen(port, () => console.log(`Server running on ${port}`))

const roomcodes = []
const gameRooms = []

io.on("connect", socket => {
  let currUser
  let joinedRoom

  console.log(`User(${socket.id}) connected`)

  // Sends user socket id to the client when the connection established
  socket.emit('user connect', socket.id)

  socket.on('user enter', userName => {
    currUser = {
      userName,
      id: socket.id
    }
    console.log(currUser)
  })

  // User creates game-room
  socket.on('game created', roomInfo => {
    joinedRoom = generatesRoomcode()

    roomInfo.roomcode = joinedRoom
    roomInfo.players = [currUser]
    gameRooms.push(roomInfo)
    socket.join(joinedRoom)

    console.log(roomInfo)
    socket.emit('send roomInfo', roomInfo)
  })

  // User search game-room
  socket.on('find room', targetRoomcode => {
    if(roomcodes.includes(targetRoomcode)) {
      const gameroomIndex = findRoomIndex(targetRoomcode)
      gameRooms[gameroomIndex].players.push(currUser)
      joinedRoom = gameRooms[gameroomIndex].roomcode

      socket.join(joinedRoom)
      socket.emit('room found', gameRooms[gameroomIndex])
      socket.to(joinedRoom).emit('user join gameroom', gameRooms[gameroomIndex])
    } else {
      socket.emit('room not found')
    }
  })

  // User disconnects
  socket.on('disconnect', () => {
    
  })
})

function generatesRoomcode() {
  const alphabets = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  
  while(true) {
    const generatedCode = 
    alphabets.charAt(Math.floor(Math.random() * alphabets.length)) +
    alphabets.charAt(Math.floor(Math.random() * alphabets.length)) +
    alphabets.charAt(Math.floor(Math.random() * alphabets.length)) +
    alphabets.charAt(Math.floor(Math.random() * alphabets.length))

    if (roomcodes.length > 456976) {
      return "Rooms are full"
    } else if (!roomcodes.includes(generatedCode)) {
      roomcodes.push(generatedCode)
      return generatedCode
    }
  }
}

function findRoomIndex (roomcode) {
  return roomcodes.includes(roomcode) ?
    gameRooms.findIndex(room => room.roomcode === roomcode) :
    -1
}