var sink = require('sink-transform')
var PassThrough = require('stream').PassThrough
var resolver = require('resolve')
var postcss = require('postcss')
var path = require('path')
var Core = require('css-modules-loader-core')

function getModuleName (file) {
  return new Promise(function (resolve, reject) {
    resolver(file, {}, function (err, res, pkg) {
      if (err) {
        return reject(err)
      }
      return resolve(pkg.name)
    })
  })
}

module.exports = function (file, opts) {
  opts = opts || {}
  var extensions = opts.extensions ? [].concat(opts.extensions).filter(Boolean) : ['.css', '.scss', '.sass']
  if (extensions.indexOf(path.extname(file)) === -1) {
    return PassThrough()
  }
  var processor = opts.processor || postcss(
    [].concat(opts.plugin).filter(Boolean).map(function (plugin) {
      var opt
      if (Array.isArray(plugin)) {
        opt = plugin[1]
        plugin = plugin[0]
      }
      if (typeof plugin === 'string') {
        plugin = require(
          resolver.sync(plugin, {
            basedir: file
          })
        )
      }
      if (typeof plugin === 'function') {
        return plugin(opt)
      }
      return plugin
    })
  )
  var postCssOptions = opts.postCssOptions
  if (typeof postCssOptions === 'function') {
    postCssOptions = postCssOptions(file)
  }
  postCssOptions = postCssOptions || {}
  postCssOptions.from = postCssOptions.from || file
  postCssOptions.to = postCssOptions.to || file

  var parser = opts.parser
  if (parser) {
    if (typeof parser === 'string') {
      parser = require(
        resolver.sync(parser, {
          basedir: file
        })
      )
    }
    postCssOptions.parser = parser
  }

  return sink.str(function (body, done) {
    var self = this
    var exports

    processor.process(body, postCssOptions)
      .then(function (result) {
        if (!opts.modularize) {
          return result.css
        }

        return getModuleName(file)
          .then(function (modulename) {
            return moduleify(result.css, modulename, true)
          })
          .then(function (res) {
            if (opts.modularize && opts.modularize.camelCase) {
              exports = {}
              Object.keys(res.exportTokens).forEach(function (token) {
                var newToken = token.replace(/-([a-z])/g, function (g) {
                  return g[1].toUpperCase()
                })

                exports[newToken] = res.exportTokens[token]
              })
            } else {
              exports = res.exportTokens
            }
            return res.injectableSource
          })
      })
      .then(function (result) {
        return insert(result, opts.inject)
      })
      .then(function (result) {
        if (opts.modularize) {
          self.push('module.exports = ' + JSON.stringify(exports) + ';' + result)
        } else {
          self.push('module.exports = ' + result)
        }
        done()
      }, function (err) {
        self.emit('error', err)
      })
  })
}

function base64 (css) {
  css = Buffer.from(css).toString('base64')
  return 'data:text/css;base64,' + css
}

function moduleify (css, modulename) {
  return new Core()
    .load(css, modulename)
}

function insert (css, inject) {
  var exp
  if (inject === 'base64') {
    exp = 'require("browserify-postcss").byUrl("' + base64(css) + '")'
  } else if (inject === 'insert-css') {
    exp = "require('insert-css')('" + css.replace(/\\/g, '\\\\').replace(/'/gm, "\\'").replace(/[\r\n]+/gm, ' ') + "')"
  } else if (inject) {
    exp = "require('browserify-postcss')('" + css.replace(/\\/g, '\\\\').replace(/'/gm, "\\'").replace(/[\r\n]+/gm, ' ') + "')"
  } else {
    exp = JSON.stringify(css)
  }
  return exp
}
