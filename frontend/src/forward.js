import React from 'react';
import ReactDOM from 'react-dom';
import { fromJS } from 'immutable';

import * as rs from 'reactstrap';


var createAppBase = function(root, init, view) {
  var model = init();

  var render;

  /* wraps event handlers to create controllers.

     The returned function will use the function returned
     by the controller to update the model and trigger a render
     if needed.
   */
  var makeController = function(controller) {
    return function(event) {
      // XXX: This might be performance bottleneck
      // https://fb.me/react-event-pooling
      // XXX: it's possible to avoid this but it will lead to more confusing code
      // XXX: Actually it's buggy
      event.persist()
      var promise = controller(model)(event);
      promise.then(function(transformer) {
        if(transformer) {
          var newModel = transformer(model);
          if (newModel !== model) {
            // XXX: side effect
            model = newModel;
            render();
          }
        }
      });
    }
  };

  /* Render the application */
  render = function() {
    var html = view({model: model, mc: makeController});
    ReactDOM.render(html, root);
  };

  // sneak into an application from the outside.
  return function(change) {
    var promise = change(model);
    promise.then(function(transformer) {
      if(transformer) {
        var newModel = transformer(model);
        if (newModel !== model) {
          // XXX: side effect
          model = newModel;
          render();
        }
      }
    });
  };
};

/* URL Router */

/* FIXME: there is no need to export the router,
 instead use an Array of Array of arguments to pass
 to Router.append and validate them */
var Router = class {
  constructor() {
    this.routes = [];
  }

  append(pattern, init, view) {
    if(!pattern.startsWith('/')) {
      throw new Error("Pattern must start with a /");
    }

    this.routes.push({pattern: pattern, init:init, view: view});
  }

  async resolve(model) {
    var path = document.location.pathname.split('/');
    var match, params;

    for(var index=0; index<this.routes.length; index++) {
      var route = this.routes[index];
      [match, params] = this.match(route, path);

      if (match) {
        var location = fromJS({
          pattern: route.pattern,
          view: route.view,
          params: params
        });

        // pass a transient model to route init.
        model = model.set('%location', location);
        var transformer = await route.init(model);
        if (!transformer) {
          throw new Error('route initialisation must return a transformer');
        }
        
        // 1) always keep the location in the final model
        // 2) Use the model passed to resolve, so that code up
        //    the stack has a chance to change the model before
        //    a redirect.
        // eslint-disable-next-line
        return _ => transformer(model).set('%location', location);
      }
    }

    // FIXME: replace with 404 error page
    throw new Error('no matching route found');
  }

  match(route, path) {
    var pattern = route.pattern.split("/");

    // if pattern and path are not the same length
    // they can not match
    if (pattern.length !== path.length) {
      return [false, {}];
    }

    // try to match
    var params = {};
    for (var index=0; index < pattern.length; index++) {
      var component = pattern[index];
      if (component.startsWith('{') && component.endsWith('}')) {
        params[component.slice(1, -1)] = path[index];
      } else if (component !== path[index]) {
        return [false, {}]
      } else {
        continue;
      }
    }

    return [true, params];
  }
}

/**
 * Create the app environment, run the app and return a function that allows
 * to sneak into it.
 *
 * @param {container_id} the html identifier of the dom element where to
 *        render the application.
 * @param {router} a {Router} instance.
 * @returns {Function} a function that allows to sneak into the app closure
 *          from the outside world.
 */
var createApp = function(container_id, router) {
  // prepare createAppBase arguments
  var root = document.getElementById(container_id);
  var init = function() { return fromJS({'%router': router}) };
  var view = function({model, mc}) {
    return model.getIn(['%location', 'view'])({model, mc});
  }

  var change = createAppBase(root, init, view);

  window.onpopstate = function(event) { return change(router.resolve.bind(router)); };

  change(router.resolve.bind(router)); // trigger a render

  return change;
}

var linkClicked = function(href) {
  return function(model) {
    return async function(event) {
      event.preventDefault();
      window.history.pushState({}, "", href);
      var router = model.get('%router');
      var transformer = router.resolve(model);
      window.scrollTo(0, 0);
      return transformer;
    }
  }
}

var redirect = async function(model, href) {
  window.history.pushState({}, "", href);
  var router = model.get('%router');
  var transformer = await router.resolve(model);
  window.scrollTo(0, 0);
  return transformer;
}

var Link = function({mc, href, children, className}) {
  return <a href={href} onClick={mc(linkClicked(href))} className={className}>{children}</a>;
}

var clean = async function(model) {
  return function(model) {
    var newModel = fromJS({});
    // only keep things that start with %
    model.keySeq()
         .filter((x) => x.startsWith('%'))
         .forEach(function(key) {
           newModel = newModel.set(key, model.get(key));
         });
    return newModel;
  }
}

var saveAs = function(name) {
  return function(model) {
    return async function (event) {
      let value = event.target.value;
      // FIXME: pass name as an array and use model.setIn
      return model => model.set(name, value);
    }
  }
}

class Title extends React.Component {
  constructor(props) {
    super(props);
    this.title = props.title;
  }

  componentDidMount() {
    document.title = this.props.title;
  }

  componentDidUpdate() {
    document.title = this.props.title;
  }

  render() {
    return <div/>;
  }
}

var get = function(path, token) {
  var request = new Request(path);
  if (token) {
    request.headers.set('X-AUTH-TOKEN', token)
  }
  return fetch(request);
}

var post = function(path, data, token) {
  var request = new Request(path, {method: 'POST', body: JSON.stringify(data)});
  if (token) {
    request.headers.set('X-AUTH-TOKEN', token);
  }
  return fetch(request);
}


/**
 *  Get the auth token from the model or localStorage
 */
var getToken = function(model) {
  return model.get('%token') || window.localStorage.getItem('%token');
}

var Input = function({label, text, error, onChange, type}) {
  var state, feedback;
  if (error) {
    state = "danger";
    feedback = <rs.FormFeedback>{error}</rs.FormFeedback>;
  } else {
    state = undefined;
    feedback = '';
  }
  text = text ? <rs.FormText color="muted">{text}</rs.FormText> : "";
  return (
    <rs.FormGroup color={state}>
      <rs.Input type={type} state={state} onChange={onChange} placeholder={label}/>
      {feedback}
      {text}
    </rs.FormGroup>
  );
}


export default {
  Link,
  Router,
  Title,
  clean,
  createApp,
  redirect,
  saveAs,
  fromJS,
  get,
  post,
  getToken,
  Input,
};
