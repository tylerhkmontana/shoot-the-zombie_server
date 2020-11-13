const express = require("express")
const { clearInterval } = require("timers")
const app = express()
const axios = require("axios")
const { join } = require("path")
const server = require("http").createServer(app)
const io = require("socket.io")(server)

const port = process.env.PORT || 5000

server.listen(port, () => console.log(`Server running on ${port}`))

const roomcodes = []
const gameRooms = []
const inGameRooms = []

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
  })

  // User creates game-room
  socket.on('room created', roomInfo => {
    joinedRoom = generatesRoomcode()

    roomInfo.roomcode = joinedRoom
    roomInfo.players = [currUser]
    roomInfo = {
      ...roomInfo,
      gameSetting: {
        numBullets: 1
      }
    }
    gameRooms.push(roomInfo)
    socket.join(joinedRoom)

    socket.emit('send roomInfo', roomInfo)
  })

  // User search game-room
  socket.on('find room', targetRoomcode => {
    if(roomcodes.includes(targetRoomcode)) {
      const gameroomIndex = findRoomIndex(targetRoomcode, gameRooms)
      if(findRoomIndex(targetRoomcode, inGameRooms) >= 0) {
        socket.emit('room in game')
      } else if(gameRooms[gameroomIndex].players.length === gameRooms[gameroomIndex].numPlayers) {
        socket.emit('full house')
      } else {
        gameRooms[gameroomIndex].players.push(currUser)
        joinedRoom = gameRooms[gameroomIndex].roomcode
  
        socket.join(joinedRoom)
        socket.emit('room found', gameRooms[gameroomIndex])
        socket.to(joinedRoom).emit('user join gameroom', gameRooms[gameroomIndex])
        socket.to(joinedRoom).emit('update message', `${currUser.userName} has joined the room`)
      }
    } else {
      socket.emit('room not found')
    }
  })

  // User exits the room
  socket.on("user exit room", () => {
    const gameroomIndex = findRoomIndex(joinedRoom, gameRooms)
    const playerIndex = gameRooms[gameroomIndex].players.findIndex(player => player.id === socket.id)
    gameRooms[gameroomIndex].players.splice(playerIndex, 1)

    if (gameRooms[gameroomIndex].players.length === 0) {
      gameRooms.splice(gameroomIndex, 1)
      roomcodes.splice(roomcodes.indexOf(joinedRoom), 1)
    } else {
      socket.to(joinedRoom).emit('user leave gameroom', {
        roomInfo: gameRooms[gameroomIndex],
        leavingUser: currUser
      })
      socket.to(joinedRoom).emit('update message', `${currUser.userName} has left the room`)
    }
    socket.leave(joinedRoom)
    joinedRoom = null
  })

  // Room Master starts the game
  socket.on('start game', async inGameRoomInfo => {
    io.in(joinedRoom).emit('game started')
    try {
      inGameRoomInfo.gifData = (await axios.get('http://api.giphy.com/v1/gifs/random?api_key=V4nELc7KIaOyaaXbsCZfRaAqs98hHW2j')).data.data
    } catch(err) {
      console.log(err)
      inGameRoomInfo.gifData = null
    }

    inGameRooms.push(inGameRoomInfo)
    const currInGameRoom = inGameRooms[findRoomIndex(joinedRoom, inGameRooms)]
    io.in(joinedRoom).emit('virus timer', currInGameRoom.gameSetting.infectionRate)
    appointToRoles(currInGameRoom.players)

    currInGameRoom.virusTimer = setInterval(async () => {
      console.log("Spread VIRUS!!!")
      try {
        currInGameRoom.gifData = (await axios.get('http://api.giphy.com/v1/gifs/random?api_key=V4nELc7KIaOyaaXbsCZfRaAqs98hHW2j&tag=funny')).data.data
      } catch(err) {
        console.log(err)
        currInGameRoom.gifData = null
      }
      if(spreadVirus(currInGameRoom, io)) {
        clearInterval(currInGameRoom.virusTimer)
        inGameRooms.splice(findRoomIndex(joinedRoom, inGameRooms), 1)
      
        console.log("Game Over")
        
        io.in(joinedRoom).emit('Gameover', 'zombie')
        io.in(joinedRoom).emit('update message', 'GAME OVER...')
      }
    }, currInGameRoom.gameSetting.infectionRate)
  })

  // // User enters the in-game
  // socket.on('what is my role', userId => {
  //   const currGameRoomIndex = findRoomIndex(joinedRoom, inGameRooms)

  //   let currGamePlayers = [...inGameRooms[currGameRoomIndex].players]
  //   let myRole = currGamePlayers[currGamePlayers.findIndex(player => player.id === userId)].role

  //   if (myRole === 'zombie') {
  //     socket.emit('appointed to zombie')
  //   } else if (myRole === 'leader') {
  //     socket.emit('appointed to leader')
  //   } else {
  //     socket.emit('appointed to civilian')
  //   }
  
  // })

  socket.on("restart", () => {
    const currGameroom = {...gameRooms[findRoomIndex(joinedRoom, gameRooms)]}
    io.in(joinedRoom).emit("move to room", currGameroom)
  })

  //////////////////////////////////// LEADER /////////////////////////////////////////////
  
  // Appointed to leader and receive leader's power
  socket.on("I am the leader", () => {
    const currGameRoomIndex = findRoomIndex(joinedRoom, inGameRooms)
    const numBullets = inGameRooms[currGameRoomIndex].gameSetting.numBullets
    const targetPlayers = inGameRooms[currGameRoomIndex].players.filter(player => player.role !== 'leader' && player.role !== 'dead')

    socket.emit("receive bullets", { numBullets, targetPlayers })
  })

  // Leader kills a player
  socket.on("leader shoots player", targetId => {
    const currInGameRoom = inGameRooms[findRoomIndex(joinedRoom, inGameRooms)]
    
    if(typeof currInGameRoom !== 'undefined' && currInGameRoom.gameSetting.numBullets > 0) {
        
      const [killedPlayer] = currInGameRoom.players.filter(player => player.id === targetId)

      const whoIsKilled = killedPlayer.role
      killedPlayer.role = 'dead'
      io.to(targetId).emit("you are dead")
 
      const targetPlayers = currInGameRoom.players.filter(player => player.role !== 'leader' && player.role !== 'dead')
      const leftCilvilians = targetPlayers.filter(player => player.role === 'civilian')
      const leftZombies = targetPlayers.filter(player => player.role === 'zombie')

      if(leftCilvilians.length === 0) {
        clearInterval(currInGameRoom.virusTimer)
        inGameRooms.splice(findRoomIndex(joinedRoom, inGameRooms), 1)

        console.log("GAME OVER, ZOMBIES WIN!!")
        io.in(joinedRoom).emit("update message", "GAME OVER...")
        io.in(joinedRoom).emit("Gameover", "zombie")
        
      } else if(leftZombies.length === 0) {
        clearInterval(currInGameRoom.virusTimer)
        inGameRooms.splice(findRoomIndex(joinedRoom, inGameRooms), 1)
        
        console.log("GAME OVER, CIVILIANS WIN!!")
        
        io.in(joinedRoom).emit("update message", "GAME OVER...")
        io.in(joinedRoom).emit("Gameover", "civilian")
        
      } else {
        currInGameRoom.gameSetting.numBullets-- 
        if(whoIsKilled === 'civilian') {
          const [currLeader] = currInGameRoom.players.filter(player => player.id === currUser.id)
          const newLeader = leftCilvilians[Math.floor(Math.random() * leftCilvilians.length)]
          currLeader.role = 'civilian'
          console.log(newLeader)
          newLeader.role = 'leader'
          io.in(joinedRoom).emit("update message", `${newLeader.userName} became the new leader!`)
          io.to(newLeader.id).emit("appointed to leader")
          socket.emit("appointed to civilian")
        } else {
          socket.emit("receive bullets", {
            numBullets: currInGameRoom.gameSetting.numBullets,
            targetPlayers
          })
        }
      }
    }
  })

  socket.on("reload bullet", () => {
    console.log("reload Bullet")
    const currGameroom = inGameRooms[findRoomIndex(joinedRoom, inGameRooms)]
    if (typeof currGameroom !== 'undefined')  {
      const targetPlayers = currGameroom.players.filter(player => player.role !== 'leader' && player.role !== 'dead')
      currGameroom.gameSetting.numBullets++

      socket.emit("receive bullets", {
        numBullets: currGameroom.gameSetting.numBullets,
        targetPlayers
      })
    }
  })

  socket.on("request gif", () => {
    const gameroomIndex = findRoomIndex(joinedRoom, inGameRooms)
    const gifData = {...inGameRooms[gameroomIndex].gifData}
    socket.emit("response gif", gifData)
  })

  // User disconnects
  socket.on('disconnect', () => {
    if (joinedRoom) {
      const gameroomIndex = findRoomIndex(joinedRoom, gameRooms)
      const playerIndex = gameRooms[gameroomIndex].players.findIndex(player => player.id === socket.id)
      gameRooms[gameroomIndex].players.splice(playerIndex, 1)

      if (gameRooms[gameroomIndex].players.length === 0) {
        gameRooms.splice(gameroomIndex, 1)
        roomcodes.splice(roomcodes.indexOf(joinedRoom), 1)
      } else {
        socket.to(joinedRoom).emit('user leave gameroom', {
          roomInfo: gameRooms[gameroomIndex],
          leavingUser: currUser
        })
        socket.to(joinedRoom).emit('update message', `${currUser.userName} has left the room`)
      }
    }
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

function findRoomIndex(roomcode, gameRooms) {
  return roomcodes.includes(roomcode) ?
    gameRooms.findIndex(room => room.roomcode === roomcode) :
    -1
}

function appointToRoles(players) {
  let numPlayers = players.length
  const zombieIndex = Math.floor(Math.random() * numPlayers)
  const civilLeaderIndex = (zombieIndex + Math.floor(Math.random() * (numPlayers - 1) + 1)) % numPlayers
  
  players.forEach((player, i) => {
    if(i === zombieIndex) {
      player.role = "zombie"
      console.log(`${player.userName} became the zombie!!`)
    } else if(i === civilLeaderIndex) {
      player.role = "leader"
      console.log(`${player.userName} became the leader!!`)
    } else {
      player.role = "civilian"
    }
    io.to(player.id).emit(`appointed to ${player.role}`)
  })
}

function spreadVirus(targetRoom, io) {
  const civilianIndexs = []
  targetRoom.players.forEach((player, i) => {
    if(player.role === 'civilian') {
      civilianIndexs.push(i)
    }
  })
  const newZombieIndex =
  civilianIndexs[Math.floor(Math.random() * civilianIndexs.length)]

  targetRoom.players[newZombieIndex].role = "zombie"
  io.in(targetRoom.roomcode).emit("update message", "AAAAAAARGH!!")
  io.to(targetRoom.players[newZombieIndex].id).emit("appointed to zombie")
  
  targetRoom.players.forEach(player => {
    if(player.role === 'civilian' || player.role === 'leader') {
      io.to(player.id).emit('gif updated', targetRoom.gifData)
    }
  })

  if (civilianIndexs.length === 1) {
    return true
  } else {
    io.in(targetRoom.roomcode).emit("virus timer", targetRoom.gameSetting.infectionRate)
    return false
  }
}