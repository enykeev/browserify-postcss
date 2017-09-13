var sink = require('sink-transform')
var PassThrough = require('stream').PassThrough
var resolve = require('resolve')
var postcss = require('postcss')
var path = require('path')
var Core = require('css-modules-loader-core')

function getModuleName(file) {
  return new Promise(function (resolves, rejects) {
    resolve(file, {}, function (err, res, pkg) {
      if (err) {
        return rejects(err)
      }
      return resolves(pkg.name)
    })
  })
}

module.exports = function (file, opts) {
  opts = opts || {}
  var extensions = ['.css', '.scss', '.sass'].concat(opts.extensions).filter(Boolean)
  if (extensions.indexOf(path.extname(file)) === -1) {
    return PassThrough()
  }
  var processor = opts.processor || createProcessor(opts)
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
        resolve.sync(String(parser), {
          basedir: opts.basedir || process.cwd(),
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
      })
      .then(function (result) {
        return insert(result, opts.inject)
      })
      .then(function (result) {
        if (opts.modularize) {
          self.push('module.exports = ' + exports + ';' + result)
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
  css = new Buffer(css).toString('base64')
  return 'data:text/css;base64,' + css
}

function moduleify (css, modulename) {
  return new Core()
    .load(css, modulename)
    .then(function (result) {
      exports = JSON.stringify(result.exportTokens)
      return result.injectableSource
    })
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

function createProcessor (opts) {
  return postcss(
    [].concat(opts.plugin).filter(Boolean).map(function (p) {
      var opt
      if (Array.isArray(p)) {
        opt = p[1]
        p = p[0]
      }
      if (typeof p === 'string') {
        p = require(
          resolve.sync(String(p), {
            basedir: opts.basedir || process.cwd(),
          })
        )
      }
      if (typeof p === 'function') {
        return p(opt)
      }
      return p
    })
  )
}
