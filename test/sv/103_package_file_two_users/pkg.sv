package cfg_pkg;                                     // alone in its file, no `include anywhere: two modules import it
  localparam logic [3:0] MAGIC = 4'hA;
  typedef logic [3:0] nib_t;
  function automatic nib_t twice(input nib_t x);
    twice = x << 1;
  endfunction
endpackage
