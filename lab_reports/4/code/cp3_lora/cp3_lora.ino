int num = 20;
String hexNum;

void setup() {
  // initialize both serial ports:
  Serial.begin(115200);
  Serial1.begin(115200);
  delay(1000);
  sendRAK("at+ver=?");
  delay(500);
  sendRAK("at+ver=?");
  delay(500);
  sendRAK("at+NWM=0");
  delay(500);
  sendRAK("at+P2P=923700000:12:125:0:10:14");
  delay(500);
  sendRAK("at+PRECV=0");
  delay(500);
}

void loop() {
  num = num + 1;
  hexNum = stringToHex(String(num));
  sendRAK("at+PSEND=" + String(hexNum));
  // Wait for a second before sending the next message
  delay(5000);
}

void sendRAK(String message) {
  // Define the string to be sent
  Serial.print("AT COMMAND SENT: ");
  Serial.println(message);
  // Send the string through Serial1
  Serial1.println(message);
  // Optionally, print the message to the Serial Monitor for debugging
  Serial.println("Sent: " + message);
  // Wait for a response
  while (Serial1.available() == 0) {
    // Do nothing and wait for data to become available
  }
  // Read the response from Serial1
  String response = "";

  while (Serial1.available() > 0) {
    response += (char)Serial1.read();
  }
  // Print the response to the Serial Monitor
  Serial.println("Received: " + response);
}
String stringToHex(String str) {
  String hexString = "";
  for (int i = 0; i < str.length(); i++) {
    char hex[3];  // Two characters for the hex code plus the null terminator
    sprintf(hex, "%02X", str[i]);
    hexString += hex;
  }
  return hexString;
}