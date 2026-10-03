/* dewfpga mail/account page configuration. Served as /dewfpga/config.js.
   Empty values keep every form disabled and every page in "not configured" state.
   The operator fills supabaseUrl and anonKey (the PUBLIC anon key, never the service key)
   after the migrations in mail/sql are applied and Auth redirect URLs are allowed. */
window.DEWFPGA_MAIL = {
  supabaseUrl: "",
  anonKey: "",
  siteUrl: "https://nosey-dewdrop.github.io/dewfpga"
};
