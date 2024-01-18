const express = require("express");
const cors = require("cors");
require("./config/db");

const app = express();

const Task = require("./models/taskModel");
const Model = require("./models/modelModel");
const ContactUs = require("./models/contactUsModel");
const Component = require("./models/componentModel");

const backendPath = "/backend";
// const backendPath = "";

const port = 3000;
const bodyParser = require("body-parser");

// Middleware for parsing json
app.use(bodyParser.json());
app.use(cors());

app.get(`${backendPath}/`, (req, res) => {
  return res.send("Привіт Express");
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

    const task = await Task.findByIdAndUpdate(
      taskId,
      { text, isCompleted },
      { new: true }
    );

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

    const component = await Component.findByIdAndUpdate(
      componentId,
      updatedComponent,
      {
        new: true,
      }
    );

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

// Run server
app.listen(port, () => {
  console.log(`server listening http://localhost:${port}`);
});
