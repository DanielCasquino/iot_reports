# How to run dis

## How to run esp32

js open the esp32 folder as a platformio project in vscode, then upload and monitor
dont forget to put ur stuff in include/secrets.h (ssid, password)

## how to run broker

go to broker folder, npm i, npm run dev, profit. node app runs both broker and frontend.

## firewall

don't forget to open ports lol, smth like this:

```
sudo ufw allow from 192.168.1.0/24 to any port 8080 proto tcp
sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp
sudo ufw allow from 192.168.1.0/24 to any port 1883 proto tcp
```

8080 for broker,
3000 for front,
1883 for mqtt
