const express = require("express");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion } = require("mongodb");
const cors = require("cors");
var bodyParser = require("body-parser");
require("dotenv").config();
const middleware = require("./middleware/middleware");
const { v4: uuidv4 } = require("uuid");
const { default: axios } = require("axios");
const globals = require("node-global-storage");
const app = express();
const port = process.env.PORT || 8000;
app.use(
  cors({
    origin: ["https://itghor.netlify.app/", "itghor.netlify.app/"],
    credentials: true,
  })
);

app.use(express.json());
app.use(bodyParser.json());

const uri = process.env.MONGODBURL;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

/*****Verify Web Token start code*****/
function verifyJWT(req, res, next) {
  const authHeaderToken = req.headers.authorization;
  if (!authHeaderToken) {
    return res.status(401).send({ message: "UnAuthorization Access" });
  }
  const token = authHeaderToken.split(" ")[1];
  jwt.verify(token, "secret-token", function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden Access" });
    }
    req.decoded = decoded;
    next();
  });
}
/*****Verify Web Token ends code*****/

/*****Express js mongodb crud operations start code*****/
async function run() {
  try {
    await client.connect();
    const userCollection = client.db("webnexit").collection("user");
    const orderCollection = client.db("webnexit").collection("order");

    /**User  put update api code start**/
    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      var token = jwt.sign({ email: email }, "secret-token");
      res.send({ result, token });
    });
    /**User  put update api code start**/
    app.post("/user", async (req, res) => {
      const user = req.body;
      const result = await userCollection.insertOne(user);
      res.send({ result });
    });

    /**User get find api code start**/
    app.get("/user", verifyJWT, async (req, res) => {
      const user = await userCollection.find({}).toArray();
      res.send(user);
    });
    /**User get findOne api code start**/
    app.get("/single-user", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const user = await userCollection.findOne({ email: email });
      res.send(user);
    });

    /**Make  user a Admin put api code start**/
    app.put("/user/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const requestor = req.decoded.email;
      const requestorInfo = await userCollection.findOne({ email: requestor });

      if (requestorInfo?.role === "admin") {
        const filter = { email: email };
        const updateDoc = {
          $set: { role: "admin" },
        };
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result);
      } else {
        return res.status(403).send({ message: "Forbidden Access" });
      }
    });

    /** Admin get api code start**/
    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const admin = await userCollection.findOne({ email: email });
      const isAdmin = admin.role === "admin";
      res.send({ admin: isAdmin });
    });

    /** profile update  api code start**/
    app.put("/profile/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };

      const updateDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(filter, updateDoc);

      res.send(result);
    });

    // bikash payment

    app.post(
      "/bkash/payment/create",
      middleware.bkash_auth,
      async (req, res) => {
        const { amount, email, contactNo, course } = req.body;
        globals.set("email", email);
        globals.set("contactNo", contactNo);
        globals.set("courseType", course);
        console.log();
        bkash_headers = async () => {
          return {
            "Content-Type": "application/json",
            Accept: "application/json",
            authorization: globals.get("id_token"),
            "x-app-key": process.env.bkash_api_key,
          };
        };

        try {
          const { data } = await axios.post(
            process.env.bkash_create_payment_url,
            {
              mode: "0011",
              payerReference: " ",
              callbackURL: "https://www.webnexit.com/bkash/payment/callback",
              amount: amount,
              currency: "BDT",
              intent: "sale",
              merchantInvoiceNumber: "Inv" + uuidv4().substring(0, 5),
            },
            {
              headers: await this.bkash_headers(),
            }
          );
          return res.status(200).json({ bkashURL: data.bkashURL });
        } catch (error) {
          return res.status(401).json({ error: error.message });
        }
      }
    );

    app.get(
      "/bkash/payment/callback",
      middleware.bkash_auth,
      async (req, res) => {
        const { paymentID, status } = req.query;

        if (status === "cancel") {
          return res.redirect(
            `https://www.webnexit.com/error?message=Agreement Creation failed`
          );
        }

        if (status === "failure") {
          var message =
            "আমরা ক্ষমাপ্রার্থী, আপনার অর্থপ্রদান সফল হয়নি৷ অনুগ্রহ করে আপনার পেমেন্টে  চেক করুন এবং আবার চেষ্টা করুন।";
          return res.redirect(
            `https://www.webnexit.com/error?message=${message}`
          );
        }

        if (status === "success") {
          try {
            const { data } = await axios.post(
              process.env.bkash_execute_payment_url,
              { paymentID },
              {
                headers: await this.bkash_headers(),
              }
            );
            if (data && data.statusCode === "0000") {
              const email = globals.get("email");
              const contactNo = globals.get("contactNo");
              const courseType = globals.get("courseType");

              const paymentInfo = {
                trxID: data.trxID,
                date: data.paymentExecuteTime,
                amount: parseInt(data.amount),
                paymentID: data.paymentID,
                email: email,
                contactNo: contactNo,
                courseType: courseType,
                status: false,
              };

              await orderCollection.insertOne(paymentInfo);

              return res.redirect(`https://www.webnexit.com/success`);
            } else {
              return res.redirect(
                `https://www.webnexit.com/error?message=${data.statusMessage}`
              );
            }
          } catch (error) {
            console.log(error);
            return res.redirect(
              `https://www.webnexit.com/error?message=${error.message}`
            );
          }
        }
      }
    );

    /**order get find api code start**/
    app.get("/order", verifyJWT, async (req, res) => {
      const user = await orderCollection.find({}).toArray();
      res.send(user);
    });

    /**order success  **/
    app.put("/order/:trxID", verifyJWT, async (req, res) => {
      const trxID = req.params.trxID;

      const requestorInfo = await orderCollection.findOne({ trxID: trxID });

      if (!requestorInfo) {
        return res.status(404).send({ message: "Not Found" });
      }
      const updateDoc = {
        $set: { status: true },
      };

      const result = await orderCollection.updateOne(
        { trxID: trxID },
        updateDoc
      );
      res.send(result);

      console.log(result);
    });
  } finally {
  }
}

run().catch(console.dir);

/*****Express js mongodb crud operations end code*****/

app.get("/", (req, res) => {
  res.send("Hello Express Js");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
