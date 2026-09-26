module top(input logic [15:0] sw, output logic [15:0] led);
  typedef struct packed { logic [3:0] x, y; } car_t;
  car_t [1:0] cars;                                          // two cars, one packed array of structs
  assign cars = sw;
  assign led = {8'd0, cars[sw[15]].y, cars[sw[15]].x};       // the car that sw[15] picks
endmodule
