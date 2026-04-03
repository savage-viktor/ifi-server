const express = require("express");
require("dotenv").config();
const cors = require("cors");
require("./config/db");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const app = express();

const Task = require("./models/taskModel");
const Model = require("./models/modelModel");
const ContactUs = require("./models/contactUsModel");
const Component = require("./models/componentModel");
const Service = require("./models/serviceModel");
const Client = require("./models/clientModel");
const Order = require("./models/orderModel");
const Paycontrol = require("./models/paycontrolModel");
const LegalControl = require("./models/legalControlModel");

const backendPath = "/backend";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const CLIENT_TOKEN_SECRET =
  process.env.CLIENT_TOKEN_SECRET || process.env.ADMIN_TOKEN || "client-secret";
const CLIENT_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const port = 3000;
const bodyParser = require("body-parser");

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function sanitizeClient(clientDoc) {
  if (!clientDoc) {
    return null;
  }

  const client = clientDoc.toObject ? clientDoc.toObject() : { ...clientDoc };
  delete client.password;
  return client;
}

function createSignedClientToken(client) {
  const payload = {
    clientId: String(client._id),
    exp: Date.now() + CLIENT_TOKEN_TTL_MS,
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", CLIENT_TOKEN_SECRET)
    .update(payloadBase64)
    .digest("base64url");

  return `${payloadBase64}.${signature}`;
}

function verifySignedClientToken(token) {
  if (!token || !token.includes(".")) {
    return null;
  }

  const [payloadBase64, signature] = token.split(".");
  if (!payloadBase64 || !signature) {
    return null;
  }

  const expectedSignature = crypto
    .createHmac("sha256", CLIENT_TOKEN_SECRET)
    .update(payloadBase64)
    .digest("base64url");

  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8"));
    if (!payload?.clientId || !payload?.exp || payload.exp < Date.now()) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

function requireAdmin(req, res, next) {
  const hdrToken = req.get("X-Admin-Token");
  const auth = req.get("Authorization");
  const bearer = auth && auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const token = hdrToken || bearer;

  if (!ADMIN_TOKEN || !token || !safeEqual(token, ADMIN_TOKEN)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  next();
}

async function requireClient(req, res, next) {
  const hdrToken = req.get("X-Client-Token");
  const auth = req.get("Authorization");
  const bearer = auth && auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const token = hdrToken || bearer;
  const payload = verifySignedClientToken(token);

  if (!payload) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const client = await Client.findById(payload.clientId).select("+password");
  if (!client) {
    return res.status(401).json({ error: "unauthorized" });
  }

  req.client = client;
  next();
}

function getClientOrderQuery(client) {
  return {
    "client.firstName": client.firstName,
    "client.lastName": client.lastName,
    "client.phone": client.phone,
  };
}

function getClientVisiblePrices(prices, client) {
  const clientFullName = `${client.lastName} ${client.firstName}`;

  return (prices || []).filter((price) => {
    const priceClients = price.clients || [];
    const priceDropshippers = price.dropshippers || [];
    const isGeneralPrice = priceClients.length === 0 && priceDropshippers.length === 0;
    const isClientPrice = priceClients.includes(clientFullName);
    const isDropshipperPrice = priceDropshippers.includes(clientFullName);

    return isGeneralPrice || isClientPrice || isDropshipperPrice;
  });
}

// Middleware for parsing json
app.use(bodyParser.json());
app.use(cors());

app.get(`${backendPath}/`, (req, res) => {
  return res.send("Привіт Express");
});

// Email transporter
const transporter = nodemailer.createTransport({
  host: "smtp.ukr.net",
  port: 465,
  secure: true,
  auth: {
    user: "viktor.dkn@ukr.net",
    pass: "wyKgYKRTkkm1DZg2",
  },
});

// Tasks endpoint
app.get(`${backendPath}/tasks`, async (req, res) => {
  try {
    const tasks = await Task.find();
    return res.status(200).json(tasks);
  } catch (error) {
    console.error("Task creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.get(`${backendPath}/tasks/:id`, async (req, res) => {
  try {
    const taskId = req.params.id;
    const task = await Task.findById(taskId);

    if (!task) {
      return res.status(404).json({ message: "Завдання не знайдено" });
    }

    return res.status(200).json(task);
  } catch (error) {
    console.error("Task creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.post(`${backendPath}/tasks`, async (req, res) => {
  try {
    const newTask = req.body;
    const task = await Task.create({ text: newTask.text });

    if (!task) {
      return res.status(404).json({ message: "Завдання не створене" });
    }

    return res.status(201).json(task);
  } catch (error) {
    console.error("Task creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.put(`${backendPath}/tasks/:id`, async (req, res) => {
  try {
    const { text, isCompleted } = req.body;
    const taskId = req.params.id;

    const task = await Task.findByIdAndUpdate(taskId, { text, isCompleted }, { new: true });

    if (!task) {
      return res.status(404).json({ message: "Завдання не знайдено" });
    }

    return res.status(200).json(task);
  } catch (error) {
    console.error("Task creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.delete(`${backendPath}/tasks/:id`, async (req, res) => {
  try {
    const taskId = req.params.id;
    const task = await Task.findByIdAndDelete(taskId);
    if (!task) {
      return res.status(404).json({ message: "Завдання не знайдено" });
    }
    return res.status(200).json(task);
  } catch (error) {
    console.error("Task creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

// Models endpoint
app.get(`${backendPath}/models`, async (req, res) => {
  try {
    const models = await Model.find();
    return res.status(200).json(models);
  } catch (error) {
    console.error("Model creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.get(`${backendPath}/models/:id`, async (req, res) => {
  try {
    const modelId = req.params.id;
    const model = await Model.findById(modelId);

    if (!model) {
      return res.status(404).json({ message: "Модель не знайдено" });
    }

    return res.status(200).json(model);
  } catch (error) {
    console.error("Model creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.post(`${backendPath}/models`, async (req, res) => {
  try {
    const newModel = req.body;
    const model = await Model.create(newModel);

    if (!model) {
      return res.status(404).json({ message: "Модель не створено" });
    }

    return res.status(201).json(model);
  } catch (error) {
    console.error("Model creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.put(`${backendPath}/models/:id`, async (req, res) => {
  try {
    const updatedModel = req.body;
    const modelId = req.params.id;

    const model = await Model.findByIdAndUpdate(modelId, updatedModel, {
      new: true,
    });

    if (!model) {
      return res.status(404).json({ message: "Модель не знайдено" });
    }

    return res.status(200).json(model);
  } catch (error) {
    console.error("Model creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.delete(`${backendPath}/models/:id`, async (req, res) => {
  try {
    const modelId = req.params.id;
    const model = await Model.findByIdAndDelete(modelId);
    if (!model) {
      return res.status(404).json({ message: "Модель не знайдено" });
    }
    return res.status(200).json(model);
  } catch (error) {
    console.error("Model creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

// ContactUs endpoint
app.get(`${backendPath}/contactUs`, async (req, res) => {
  try {
    const messages = await ContactUs.find();
    return res.status(200).json(messages);
  } catch (error) {
    console.error("Message creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.get(`${backendPath}/contactUs/:id`, async (req, res) => {
  try {
    const contactUsId = req.params.id;
    const message = await ContactUs.findById(contactUsId);

    if (!message) {
      return res.status(404).json({ message: "Повідомлення не знайдено" });
    }

    return res.status(200).json(message);
  } catch (error) {
    console.error("Message creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.post(`${backendPath}/contactUs`, async (req, res) => {
  try {
    const newContactUs = req.body;
    const contactUs = await ContactUs.create(newContactUs);

    if (!contactUs) {
      return res.status(404).json({ message: "Повідомлення не створено" });
    }

    const mailOptions = {
      from: "viktor.dkn@ukr.net",
      to: "viktor.dkn@gmail.com",
      subject: `Повідомлення від ${req.body.name}`,
      html: `<p>Ім'я: ${req.body.name}</p> <p>Номер: ${req.body.phone}</p> <p>Пошта: ${req.body.email}</p> <p>Повідомлення: ${req.body.message}</p>`,
    };

    transporter.sendMail(mailOptions, function (error, info) {
      if (error) {
        console.log("Email sent error", error);
      } else {
        console.log("Email sent: " + info.response);
      }
    });

    return res.status(201).json(contactUs);
  } catch (error) {
    console.error("Message creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.delete(`${backendPath}/contactUs/:id`, async (req, res) => {
  try {
    const contactUsId = req.params.id;
    const contactUs = await ContactUs.findByIdAndDelete(contactUsId);
    if (!contactUs) {
      return res.status(404).json({ message: "Повідомлення не знайдено" });
    }
    return res.status(200).json(contactUs);
  } catch (error) {
    console.error("Message creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

// Components endpoint
app.get(`${backendPath}/components`, async (req, res) => {
  try {
    const components = await Component.find();
    return res.status(200).json(components);
  } catch (error) {
    console.error("Component creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.get(`${backendPath}/components/:id`, async (req, res) => {
  try {
    const componentId = req.params.id;
    const component = await Component.findById(componentId);

    if (!component) {
      return res.status(404).json({ message: "Компонент не знайдено" });
    }

    return res.status(200).json(component);
  } catch (error) {
    console.error("Component creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.post(`${backendPath}/components`, async (req, res) => {
  try {
    const newComponent = req.body;
    const component = await Component.create(newComponent);

    if (!component) {
      return res.status(404).json({ message: "Компонент не створено" });
    }

    return res.status(201).json(component);
  } catch (error) {
    console.error("Component creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.put(`${backendPath}/components/:id`, async (req, res) => {
  try {
    const updatedComponent = req.body;
    const componentId = req.params.id;

    const component = await Component.findByIdAndUpdate(componentId, updatedComponent, {
      new: true,
    });

    if (!component) {
      return res.status(404).json({ message: "Компонент не знайдено" });
    }

    return res.status(200).json(component);
  } catch (error) {
    console.error("Component creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.delete(`${backendPath}/components/:id`, async (req, res) => {
  try {
    const componentId = req.params.id;
    const component = await Component.findByIdAndDelete(componentId);
    if (!component) {
      return res.status(404).json({ message: "Компонент не знайдено" });
    }
    return res.status(200).json(component);
  } catch (error) {
    console.error("Component creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

// Service endpoint
app.get(`${backendPath}/services`, async (req, res) => {
  try {
    const services = await Service.find();
    return res.status(200).json(services);
  } catch (error) {
    console.error("Service creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.get(`${backendPath}/services/:id`, async (req, res) => {
  try {
    const serviceId = req.params.id;
    const service = await Service.findById(serviceId);

    if (!service) {
      return res.status(404).json({ message: "Послугу не знайдено" });
    }

    return res.status(200).json(service);
  } catch (error) {
    console.error("Service creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.post(`${backendPath}/services`, async (req, res) => {
  try {
    const newService = req.body;
    const service = await Service.create(newService);

    if (!service) {
      return res.status(404).json({ message: "Послугу не створено" });
    }

    return res.status(201).json(service);
  } catch (error) {
    console.error("Service creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.put(`${backendPath}/services/:id`, async (req, res) => {
  try {
    const updatedService = req.body;
    const serviceId = req.params.id;

    const service = await Service.findByIdAndUpdate(serviceId, updatedService, {
      new: true,
    });

    if (!service) {
      return res.status(404).json({ message: "Послугу не знайдено" });
    }

    return res.status(200).json(service);
  } catch (error) {
    console.error("Service creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.delete(`${backendPath}/services/:id`, async (req, res) => {
  try {
    const serviceId = req.params.id;
    const service = await Service.findByIdAndDelete(serviceId);
    if (!service) {
      return res.status(404).json({ message: "Послугу не знайдено" });
    }
    return res.status(200).json(service);
  } catch (error) {
    console.error("Service creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

// Client endpoint
app.get(`${backendPath}/clients`, async (req, res) => {
  try {
    const clients = await Client.find();
    return res.status(200).json(clients.map(sanitizeClient));
  } catch (error) {
    console.error("Client creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.get(`${backendPath}/clients/:id`, async (req, res) => {
  try {
    const clientId = req.params.id;
    const client = await Client.findById(clientId);

    if (!client) {
      return res.status(404).json({ message: "Клієнта не знайдено" });
    }

    return res.status(200).json(sanitizeClient(client));
  } catch (error) {
    console.error("Client creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.post(`${backendPath}/clients`, async (req, res) => {
  try {
    const newClient = req.body;
    const client = await Client.create(newClient);

    if (!client) {
      return res.status(404).json({ message: "Клієнта не створено" });
    }

    return res.status(201).json(sanitizeClient(client));
  } catch (error) {
    console.error("Client creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.put(`${backendPath}/clients/:id`, async (req, res) => {
  try {
    const updatedClient = req.body;
    const clientId = req.params.id;

    const client = await Client.findByIdAndUpdate(clientId, updatedClient, {
      new: true,
      runValidators: true,
    });

    if (!client) {
      return res.status(404).json({ message: "Клієнта не знайдено" });
    }

    return res.status(200).json(sanitizeClient(client));
  } catch (error) {
    console.error("Client creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.delete(`${backendPath}/clients/:id`, async (req, res) => {
  try {
    const clientId = req.params.id;
    const client = await Client.findByIdAndDelete(clientId);
    if (!client) {
      return res.status(404).json({ message: "Клієнта не знайдено" });
    }
    return res.status(200).json(sanitizeClient(client));
  } catch (error) {
    console.error("Client creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

// Client portal endpoint
app.post(`${backendPath}/client/login`, async (req, res) => {
  try {
    const login = String(req.body?.login || "").trim();
    const password = String(req.body?.password || "");

    if (!login || !password) {
      return res.status(400).json({ error: "login_and_password_required" });
    }

    const client = await Client.findOne({ login }).select("+password");
    if (!client || !client.password || !safeEqual(client.password, password)) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    const token = createSignedClientToken(client);

    return res.status(200).json({
      token,
      client: sanitizeClient(client),
    });
  } catch (error) {
    console.error("Client login error", error);
    return res.status(500).json({ error: error.message });
  }
});

app.get(`${backendPath}/client/me`, requireClient, async (req, res) => {
  return res.status(200).json(sanitizeClient(req.client));
});

app.get(`${backendPath}/client/orders`, requireClient, async (req, res) => {
  try {
    const orders = await Order.find(getClientOrderQuery(req.client)).sort({ orderNumber: -1 });
    return res.status(200).json(orders);
  } catch (error) {
    console.error("Client orders error", error);
    return res.status(500).json({ error: error.message });
  }
});

app.get(`${backendPath}/client/prices`, requireClient, async (req, res) => {
  try {
    const services = await Service.find();
    const visibleServices = services
      .map((service) => {
        const visiblePrices = getClientVisiblePrices(service.prices, req.client);
        if (visiblePrices.length === 0) {
          return null;
        }

        return {
          ...service.toObject(),
          prices: visiblePrices,
        };
      })
      .filter(Boolean);

    return res.status(200).json(visibleServices);
  } catch (error) {
    console.error("Client prices error", error);
    return res.status(500).json({ error: error.message });
  }
});

// Order endpoint
app.get(`${backendPath}/orders`, async (req, res) => {
  try {
    const orders = await Order.find();
    return res.status(200).json(orders);
  } catch (error) {
    console.error("Order creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.get(`${backendPath}/orders/:id`, async (req, res) => {
  try {
    const orderId = req.params.id;
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: "Замовлення не знайдено" });
    }

    return res.status(200).json(order);
  } catch (error) {
    console.error("Order creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.post(`${backendPath}/orders`, async (req, res) => {
  try {
    const lastOrder = await Order.find().limit(1).sort({ $natural: -1 });

    let lastOrderNumber = 2700000;
    if (lastOrder.length !== 0) {
      lastOrderNumber = lastOrder[0].orderNumber;
    }

    const newOrderNumber = lastOrderNumber + 1;
    const newOrder = { ...req.body, orderNumber: newOrderNumber };
    const order = await Order.create(newOrder);

    if (!order) {
      return res.status(404).json({ message: "Замовлення не створено" });
    }

    return res.status(201).json(order);
  } catch (error) {
    console.error("Order creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.put(`${backendPath}/orders/:id`, async (req, res) => {
  try {
    const updatedOrder = req.body;
    const orderId = req.params.id;

    const order = await Order.findByIdAndUpdate(orderId, updatedOrder, {
      new: true,
    });

    if (!order) {
      return res.status(404).json({ message: "Замовлення не знайдено" });
    }

    return res.status(200).json(order);
  } catch (error) {
    console.error("Order creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.delete(`${backendPath}/orders/:id`, async (req, res) => {
  try {
    const orderId = req.params.id;
    const order = await Order.findByIdAndDelete(orderId);
    if (!order) {
      return res.status(404).json({ message: "Замовлення не знайдено" });
    }
    return res.status(200).json(order);
  } catch (error) {
    console.error("Order creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

// Paycontrol endpoint
app.get(`${backendPath}/paycontrols`, async (req, res) => {
  try {
    const paycontrol = await Paycontrol.find();
    return res.status(200).json(paycontrol);
  } catch (error) {
    console.error("Paycontrol creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.get(`${backendPath}/paycontrols/:id`, async (req, res) => {
  try {
    const paycontrolId = req.params.id;
    const paycontrol = await Paycontrol.findById(paycontrolId);

    if (!paycontrol) {
      return res.status(404).json({ message: "Запис не знайдено" });
    }

    return res.status(200).json(paycontrol);
  } catch (error) {
    console.error("Paycontrol creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.post(`${backendPath}/paycontrols`, async (req, res) => {
  try {
    const newPaycontrol = req.body;
    const paycontrol = await Paycontrol.create(newPaycontrol);

    if (!paycontrol) {
      return res.status(404).json({ message: "Запис не створено" });
    }

    return res.status(201).json(paycontrol);
  } catch (error) {
    console.error("Paycontrol creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.put(`${backendPath}/paycontrols/:id`, async (req, res) => {
  try {
    const updatedPaycontrol = req.body;
    const paycontrolId = req.params.id;

    const paycontrol = await Paycontrol.findByIdAndUpdate(paycontrolId, updatedPaycontrol, {
      new: true,
    });

    if (!paycontrol) {
      return res.status(404).json({ message: "Запис не знайдено" });
    }

    return res.status(200).json(paycontrol);
  } catch (error) {
    console.error("Paycontrol creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

app.delete(`${backendPath}/paycontrols/:id`, async (req, res) => {
  try {
    const paycontrolId = req.params.id;
    const paycontrol = await Paycontrol.findByIdAndDelete(paycontrolId);
    if (!paycontrol) {
      return res.status(404).json({ message: "Запис не знайдено" });
    }
    return res.status(200).json(paycontrol);
  } catch (error) {
    console.error("Paycontrol creation error" + error);
    return res.status(500).json({ error: error.message });
  }
});

// LegalControl endpoint
app.post(`${backendPath}/legalControl`, async (req, res) => {
  try {
    const { uniqnum, devicemodel, firmware } = req.body || {};

    const uniqStr = String(uniqnum || "").trim();
    if (!/^\d{10,15}$/.test(uniqStr)) {
      return res.status(400).json({ error: "uniqnum must be 10 to 15 digits" });
    }

    const modelStr = String(devicemodel || "").trim();
    if (!modelStr) {
      return res.status(400).json({ error: "devicemodel is required" });
    }

    const fwStr = String(firmware || "unknown").trim();

    const update = {
      $set: { devicemodel: modelStr, firmware: fwStr },
      $inc: { requests: 1 },
      $setOnInsert: { deviceStatus: "normal" },
    };

    const hasVpnField = Object.prototype.hasOwnProperty.call(req.body || {}, "vpnid");
    const rawVpn = hasVpnField ? req.body.vpnid : undefined;
    const vpnStr = typeof rawVpn === "string" ? rawVpn.trim() : rawVpn;

    if (!hasVpnField || vpnStr === "" || vpnStr === null) {
      update.$unset = { vpnid: "" };
    } else {
      if (!/^[A-Za-z0-9._:\-]{1,128}$/.test(String(vpnStr))) {
        return res.status(400).json({ error: "invalid vpnid format" });
      }
      update.$set.vpnid = String(vpnStr);
    }

    const doc = await LegalControl.findOneAndUpdate({ uniqnum: uniqStr }, update, {
      new: true,
      upsert: true,
    });

    return res.json({
      _id: doc._id,
      uniqnum: doc.uniqnum,
      devicemodel: doc.devicemodel,
      firmware: doc.firmware,
      vpnid: doc.vpnid || null,
      deviceStatus: doc.deviceStatus,
      requests: doc.requests,
      updatedAt: doc.updatedAt,
      createdAt: doc.createdAt,
    });
  } catch (err) {
    console.error("legalControl error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

app.get(`${backendPath}/legalControl`, requireAdmin, async (req, res) => {
  try {
    const list = await LegalControl.find().sort({ createdAt: -1 }).lean();
    return res.json(list);
  } catch (err) {
    console.error("GET /backend/legalControl error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

app.put(`${backendPath}/legalControl/:uniqnum/status`, requireAdmin, async (req, res) => {
  try {
    const uniqnum = String(req.params.uniqnum || "").trim();
    const { deviceStatus } = req.body || {};

    if (!/^\d{10,15}$/.test(uniqnum)) {
      return res.status(400).json({ error: "uniqnum must be 10 to 15 digits" });
    }
    const allowed = ["normal", "lock", "locked", "unlocked", "idle", "controlDisabled"];
    if (!allowed.includes(deviceStatus)) {
      return res.status(400).json({ error: `deviceStatus must be one of: ${allowed.join(", ")}` });
    }

    const doc = await LegalControl.findOneAndUpdate(
      { uniqnum },
      { $set: { deviceStatus } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: "not_found" });

    res.json({
      _id: doc._id,
      uniqnum: doc.uniqnum,
      devicemodel: doc.devicemodel,
      deviceStatus: doc.deviceStatus,
      requests: doc.requests,
      updatedAt: doc.updatedAt,
      createdAt: doc.createdAt,
    });
  } catch (err) {
    console.error("PUT /backend/legalControl/:uniqnum/status error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.delete(`${backendPath}/legalControl/:uniqnum`, requireAdmin, async (req, res) => {
  try {
    const uniqnum = String(req.params.uniqnum || "").trim();

    if (!/^\d{10,15}$/.test(uniqnum)) {
      return res.status(400).json({ error: "uniqnum must be 10 to 15 digits" });
    }

    const doc = await LegalControl.findOneAndDelete({ uniqnum });
    if (!doc) {
      return res.status(404).json({ error: "not_found" });
    }

    return res.json({
      message: "record deleted",
      uniqnum: doc.uniqnum,
      devicemodel: doc.devicemodel,
      firmware: doc.firmware,
      deviceStatus: doc.deviceStatus,
      requests: doc.requests,
      deletedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("DELETE /backend/legalControl/:uniqnum error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// Run server
app.listen(port, () => {
  console.log(`server listening http://localhost:${port}`);
});