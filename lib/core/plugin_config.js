/*
 * 插件解析模块
 * 1. 根据项目类型，获取项目生命周期，获取基本的插件列表
 * 2. 根据用户自定义配置，获取用户自定义插件
 * 3. 接受用户对插件的参数配置，收集相应的参数信息，传递给插件。
 * 4. 返回最终的插件列表。
 */
// 根据用户的action, 分析出插件列表。
// 每一个阶段会有一个模块，负责本阶段插件的参数信息准备调用和处理.

var path = require('path');
var async = require('async');
var vm = require('vm');
var Opts = require('../utils/opts.js');
var pluginConfig = require('./plugin_config.js')
var moduleHelp = require('../utils/module_help.js');
var fsExt = require('../utils/fs_ext.js');
var Plugin = require('./plugin.js');

// TODO 用户可以通过配置文件进行覆盖.
var LifeCycle = [{
    'clean': ['clean']
}, {
    'resources': ['resources'] // 代码输出到build目录.
}, {
    'compile': ['coffee', 'less'] // 代码编译.
}, {
    'analyse': ['jshint', 'loadSourceConfig', 'dependencies', 'depCheck'] //依赖分析.
}, {
    'preBuild': ['tpl', 'css', 'define'] // 代码模块规范化.
}, {
    'output': ['output'] // 合并输出.
}, {
    'build': ['compress', 'install'] // 代码压缩和本地缓存.
}, {
    'upload': ['pack', 'upload'] // 代码上传源.
}, {
    'deploy': ['deploy'] // 代码部署.
}];

// 对于某些Action可以指定绑定插件.
var ActionPlugins = {
  
};

var getPhrases = exports.getPhrases = function(action) {
  var phrases = LifeCycle.map(function(Phrase) {
    return Object.keys(Phrase)[0]; 
  });
  if (phrases.indexOf(action) < 0) {
    return [];
  }
  return phrases.slice(0, phrases.indexOf(action) + 1);
};

/**
 * 获取指定 action 需要执行的插件列表.
 * TODO 需要从plugins中检查是否需要项目模型.
 * @param {String} action action.
 * @return {Array} 插件列表.
 */
exports.getPlugins = function(action, only, userPlugins) {
  var currentPhrases = LifeCycle.slice(0, indexOf(LifeCycle, action) + 1);
  var plugins = [];
  var plugin;
  if (currentPhrases.length > 0) {
    if (only) {
      plugins = getPlugins(currentPhrases[currentPhrases.length - 1], userPlugins);
    } else {
      currentPhrases.forEach(function(phrase) {
        [].splice.apply(plugins, [plugins.length,
          0].concat(getPlugins(phrase, userPlugins)));
      });
    }
    return plugins;
  }

  // TODO add user plugins.
  plugin = exports.getPlugin(action, action);
  if (plugin) {
    plugins = [plugin];
    return plugins;
  } 

  if (ActionPlugins[action]) {
    plugins = ActionPlugins[action];
    if (!Array.isArray(plugins)) {
      plugins = [plugins];
    }
    return plugins;
  }

  return plugins;
};

exports.getPlugin = function(pluginName, __parent) {
  // TODO 支持从源中查找.
  var plugin = null;
  var pluginDir = path.join(path.dirname(module.filename), '../plugins');
  try {
    plugin = require(path.join(pluginDir, pluginName + '.js'));
    plugin.__parent = __parent;
  } catch(e) {
    console.log('not found plugin ' + pluginName);
  }
  return plugin;
};


exports.create = function(name, run) {
  var plugin = new Plugin(name);
     
  if (run) plugin.run = run;
  return plugin;
};

function getPlugins(phrase, userPlugins) {
  var phraseName = Object.keys(phrase)[0];
  var plugins = phrase[phraseName].map(function(p) {
    return exports.getPlugin(p, phraseName);
  });
  
  if (userPlugins && userPlugins[phraseName]) {
    var actionPlugins = userPlugins[phraseName];
    if (actionPlugins.before) {
      [].splice.apply(plugins, [0, 0].concat(actionPlugins.before));
    }
    if (actionPlugins.after) {
      [].splice.apply(plugins, [plugins.length, 0].concat(actionPlugins.after));
    }
  }
  return plugins;
}

function indexOf(arrs, key) {
  var keys;
  for (var i = 0, len = arrs.length; i < len; i++) {
    keys = Object.keys(arrs[i]);
    if (keys.indexOf(key) > -1) {
        return i;
    }
  }
  return -1;
}

// load user config plugins
exports.initUserPlugins = function(model, callback) {
  var that = this;
  var actionPlugins = model.plugins;
  async.forEach(Object.keys(actionPlugins), function(actionName, callback) {
    var plugins = actionPlugins[actionName];
    var unloadPlugins = [];

    var loadPluginsFn = ['before', 'after'].map(function(pos) {
      if (plugins[pos]) {
        return function(callback) {
          loadPlugins(model, plugins[pos], function(newPlugins) {
            plugins[pos] = newPlugins;
            callback();
          });
        }
      } else {
        return function(callback) {
          callback();
        }
      }
    });

    async.parallel(loadPluginsFn, function() {
      callback();
    });

  }, function(err) {
    callback();
  });
};

// 加载用户配置插件. 如果无法加载的注册到unloadPlugins中.
var loadPlugins = exports.loadPlugins = function(model, plugins, callback) {
  var newPlugins = [];
  async.forEach(plugins, function(plugin, callback) {
    /// callback();
    var errMsg = 'unable to load ' + plugin;
    loadPlugin(plugin, function(pluginObj) {
      if (!pluginObj) {
        console.warn(errMsg);
      } else {
        newPlugins.push(pluginObj);
      }
      callback();
    });
  }, function() {
    callback(newPlugins); 
  });
   // check user plugins 
};

function loadPlugin(pluginName, callback) {
  var plugin = null;
  if (moduleHelp.isRelative(pluginName)) {
    var filepath = moduleHelp.perfectLocalPath(pluginName);
    filepath = moduleHelp.normalize(filepath);
    if (!fsExt.existsSync(filepath)) {
      callback(plugin);
    } else {
      var code = fsExt.readFileSync(filepath);
      try {
        plugin = exports.compile(code, pluginName);
      } catch(e) {
      } 
      callback(plugin);
    }
    
  } else if (pluginName.indexOf('http') === 0) {
    request(pluginName, function(err, res, body) {
      var plugin;
      if (err) {
        callback(null);
      } else {
        plugin = exports.compile(body, pluginName); 
        callback(plugin);
      }
    });
  
  } else {
    console.warn('not support plugin ' + pluginName);
    callback(null);
  } 
};


// 编译一个插件
exports.compile = function(code, filename) {
  var script = vm.createScript(code);
  var sandbox = {};
  var _exports = {};
  var _module = {'exports': _exports};
  for (var k in global) {
    sandbox[k] = global[k];
  }
  sandbox.require = require;
  sandbox.exports = _exports;
  sandbox.__filename = filename;
  sandbox.module = _module;
  sandbox.global = sandbox;
  sandbox.Plugin = Plugin;
  sandbox.fsExt = fsExt;
  vm.runInNewContext(code, sandbox, filename, true);

  return sandbox.module.exports;
}
