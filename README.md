# test

canvasの内容をMediaRecoderでエンコードしてWebSocketサーバに送信するテスト．

- canvas_cast.html Canvas要素の内容をCast. カメラから入力 or 動画ファイルをドラッグ＆ドロップで再生.
- wsproxy.go WebSocketで受けたデータを別のTCPサーバに中継するプログラム(単体動作不可)

## TODO

- Player側も作る
