// 对于指定的目录进行扫描，生成tgz和info.json信息.
// 目前扫描主要是针对源服务，其他目录格式不支持, 其中有下面几个约定.
// 1. 根目录下面会有一个config.json, 这个表明是跟项目，里面需要配置root等信息.
// 2. 根目录下面所有的目录都讲被认为是模块名. 模块目录下面为版本列表。
var fs = require('fs');
var util = require('util');
var path = require('path');
var async = require('async');

var ConfigParse = require('../core/config_parse.js');
var tar = require('../utils/tar.js');
var fsExt = require('../utils/fs_ext.js');
var ActionFactory = require('../core/action_factory.js');
var ModuleInfoQueue = require('./server/module_info_queue.js');

var Sources = ActionFactory.create('Sources');

var fileDir = process.cwd();

var MQ = new ModuleInfoQueue(fileDir);

Sources.prototype.run = function(callback) {

  var configPath = path.join(fileDir, CONFIG);
  if (!fsExt.existsSync(configPath)) {
    throw new Error (configPath + 'not found config.json');
  }
  new Modules("", fileDir, callback);
};

var CONFIG = 'config.json';

function Modules(root, baseDir, callback) {
  var that = this;

  this.baseDir = baseDir;
  var tempDir = this.tempDir = path.join(baseDir, '_build');

  var queue = async.queue(function(mod, callback) {
    var modPath = path.join(baseDir, mod);

    // 模块检查，如果发现目录里面存在config.json文件则说明是模块集合
    if (fsExt.existsSync(path.join(modPath, CONFIG))) {

      // 如果次模块也是一个根目录，那么直接只是把root名字写上.
      // 那如果用户install 一个root 是否install 下面全部子模块.
      new Modules(mod, modPath, function() {
        callback();
      }); 
      return;
    };

    // 1. 查找版本
    var versions = fsExt.listDirs(modPath);
    async.forEach(versions, function(ver, callback) {
      var modInfo = {};
      modInfo.name = mod;
      modInfo.version = ver;
      that.parseModule(modPath, mod, ver, function(subMods) {
        modInfo.output = subMods;
        MQ.register(root, modInfo);
        callback();
      });
    }, function() {
      callback();
    });

  }, 1);

  queue.drain = function() {
    // 收集所有子模块的info.json, 产生总的info.json
    // 1. clean tempDir
    // 2 write modsInfo;
    fsExt.rmdirRF(tempDir);
    // console.info(modsInfo);
    //
    console.info('module parse succ!');
    callback();
  };

  var config = new ConfigParse();
  config.addFile(path.join(baseDir, CONFIG));
  config.on('end', function(configObj) {
    // modsInfo.root = configObj.get('root');
    var mods = fsExt.listDirs(baseDir, function(dir) {
      if (dir.indexOf('.') === 0) return false;
      if (dir.indexOf('_') === 0) return false;
      return true;
    }); 
    
    if (mods.length === 0) {
      queue.drain();
    }

    mods.forEach(function(mod) {
      queue.push(mod);
    });
  });
}

Modules.prototype.parseModule = function(modPath, modName, ver, callback) {
  console.info('parsing module ' + modName + ' .....');
  var that = this;
  var codePath = path.join(modPath, ver);
  this.createTar(modName, ver, codePath, function() {
    callback(that.getSubMods(codePath));
  });
};

// TODO 后续可能还需要计算依赖.
Modules.prototype.getSubMods = function(codePath) {

  // 主要是获取模块子模块信息
  var mods = fsExt.globFiles('**/*', codePath);
  mods = mods.filter(function(m){
    var ext = path.extname(m);
    if (!ext) return false;
    if (/(\.json|\.tgz|-debug\.js)$/.test(m)) return false;
    return true;
  });
  var output = {};
  mods.forEach(function(mod) {
    output[mod] = ""; 
  });
  return output;
};

Modules.prototype.createTar = function(modName, ver, codePath, callback) {
  var tarName = modName + '.tgz';
  if (fsExt.existsSync(path.join(codePath, tarName))) {

    // 已经存在tar包
    callback();
    return;
  }

  // 模块临时目录.
  var tempModulePath = path.join(this.tempDir, modName, ver, modName);
  var tempDistPath = path.join(tempModulePath, 'dist');

  fsExt.mkdirS(tempDistPath);
  fsExt.copydirSync(codePath, tempDistPath);

  var tarPath = path.join(codePath, tarName);
  
  tar.create(tempModulePath, tarPath, function() {
    console.log('pack tar ' + tarPath + ' success!');
    callback();
  });

};

module.exports = Sources;


