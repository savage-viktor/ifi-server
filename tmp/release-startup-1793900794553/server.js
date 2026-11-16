require("dotenv").config();
require("./config/db");
const app = require("./app");
const port = process.env.PORT || 3000;

// Passenger loads this entry point via require(), so startup must be unconditional.
app.listen(port, () => console.log("server listening on port " + port));
