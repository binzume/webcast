package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var wsupgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func streamWsHandler(streamName string, w http.ResponseWriter, r *http.Request) {
	conn, err := wsupgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Printf("Failed to set websocket upgrade: %+v", err)
		return
	}

	var data map[string]interface{}
	err = conn.ReadJSON(&data)
	if err != nil {
		log.Println("readjson", err)
		return
	}
	log.Println("connect: ", data)

	// conn2, err := net.Dial("tcp", "127.0.0.1:2500")
	// defer conn2.Close()

	for {

		t, m, err := conn.ReadMessage()
		if err != nil {
			break
		}
		log.Println("message", t, m)

	}
	log.Println("disconnect")
}

func WsUrl(r *http.Request, path string) string {
	if r.TLS == nil && r.Header.Get("X-Forwarded-Proto") != "https" {
		return "ws://" + r.Host + path
	}
	return "wss://" + r.Host + path
}

func initHttpd() *gin.Engine {
	r := gin.Default()

	r.GET("/status", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"_status": 200, "message": "It works!"})
	})

	r.Static("/css", "./static/css")
	r.Static("/js", "./static/js")
	r.GET("/", func(c *gin.Context) {
		c.File("./static/index.html")
	})

	r.GET("/stream/:stream", func(c *gin.Context) {
		streamWsHandler(c.Param("stream"), c.Writer, c.Request)
	})

	return r
}

func main() {
	port := flag.Int("p", 8080, "http port")
	flag.Parse()
	gin.SetMode(gin.ReleaseMode)
	log.Printf("start server. port: %d", *port)
	initHttpd().Run(":" + fmt.Sprint(*port))
}
