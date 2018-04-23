/** @jsx h */

import { Component, h } from 'preact';
import { define } from 'skatejs';
import withRenderer from '..';

function render(Comp) {
  const el = new Comp();
  el.renderer(el, el.render.bind(el));
  return el;
}

class PreactComponent extends Component {
  render() {
    return <div>Hello, {this.props.children}!</div>;
  }
}

test('renders', () => {
  @define
  class MyElement extends withRenderer() {
    render({ name }) {
      return <div>Hello, {name}!</div>;
    }
  }

  const el = new MyElement();
  expect(el.innerHTML).toMatchSnapshot();
  el.renderer(el, el.render.bind(el, { name: 'World' }));
  expect(el.innerHTML).toMatchSnapshot();
  el.renderer(el, el.render.bind(el, { name: 'Bob' }));
  expect(el.innerHTML).toMatchSnapshot();
});

test('wrapper - override render()', () => {
  @define
  class PreactComponentWrapper extends withRenderer() {
    render() {
      return <PreactComponent {...this.props} />;
    }
  }

  const el = new PreactComponentWrapper();
  el.renderer(el, el.render.bind(el));
  expect(el.innerHTML).toMatchSnapshot();
});

test('wrappers cleanup', () => {
  const didMountSpy = jest.fn();
  const willUnmountSpy = jest.fn();
  class PreactComponent extends Component {
    componentDidMount = didMountSpy;
    componentWillUnmount = willUnmountSpy;
    render() {
      return <div>Hello, {this.props.children}!</div>;
    }
  }

  @define
  class PreactComponentWrapper extends withRenderer() {
    render() {
      return <PreactComponent {...this.props} />;
    }
  }

  const root = document.createElement('div');
  const el = new PreactComponentWrapper();
  root.appendChild(el);
  el.renderer(el, el.render.bind(el));

  expect(el.innerHTML).toMatchSnapshot();
  expect(didMountSpy).toHaveBeenCalled();

  root.removeChild(el);

  expect(el.innerHTML).toMatchSnapshot();
  expect(el._renderRoot).toBeNull();
  expect(willUnmountSpy).toHaveBeenCalled();
});

test('rendering after re-connecting works', () => {
  const root = document.createElement('div');

  const didMountSpy = jest.fn();
  const willUnmountSpy = jest.fn();
  class PreactComponent extends Component {
    componentDidMount = didMountSpy;
    componentWillUnmount = willUnmountSpy;
    render() {
      return <div />;
    }
  }

  @define
  class PreactComponentWrapper extends withRenderer() {
    render() {
      return <PreactComponent {...this.props} />;
    }
  }

  expect(didMountSpy).toHaveBeenCalledTimes(0);
  expect(willUnmountSpy).toHaveBeenCalledTimes(0);

  const el = new PreactComponentWrapper();
  root.appendChild(el);

  expect(didMountSpy).toHaveBeenCalledTimes(0);
  expect(willUnmountSpy).toHaveBeenCalledTimes(0);

  el.renderer(el, el.render.bind(el));

  expect(el.innerHTML).toMatchSnapshot();
  expect(didMountSpy).toHaveBeenCalledTimes(1);
  expect(willUnmountSpy).toHaveBeenCalledTimes(0);

  root.removeChild(el);

  expect(el.innerHTML).toMatchSnapshot();
  expect(el._renderRoot).toBeNull();
  expect(didMountSpy).toHaveBeenCalledTimes(1);
  expect(willUnmountSpy).toHaveBeenCalledTimes(1);

  // Re-connect
  root.appendChild(el);

  el.renderer(el, el.render.bind(el));

  expect(el.innerHTML).toMatchSnapshot();
  expect(didMountSpy).toHaveBeenCalledTimes(2);
  expect(willUnmountSpy).toHaveBeenCalledTimes(1);

  root.removeChild(el);

  expect(el.innerHTML).toMatchSnapshot();
  expect(el._renderRoot).toBeNull();
  expect(didMountSpy).toHaveBeenCalledTimes(2);
  expect(willUnmountSpy).toHaveBeenCalledTimes(2);
});
