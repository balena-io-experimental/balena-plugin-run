"use strict";
const path = require('path');
const fs = require('fs');
const Docker = require('dockerode');

const DOCKER_SOCKET = '/var/run/docker.sock'

// Use dockerode to create a container that has ARM instructions
// but is emulated for x86 in qemu.
function createContainer(imageId, callback) {
	let docker = new Docker({ socketPath: DOCKER_SOCKET });
	let createOpts = {
		Image: imageId,
		Tty: false,
		Env: [ 'QEMU_EXECVE=1' ],
		Entrypoint: 'qemu-arm-static'
	};
	docker.getImage(imageId).inspect((err, imageInfo) => {
		if (err) return callback(err);
		if (imageInfo && imageInfo.Config && imageInfo.Config.Cmd) {
			createOpts.Cmd = imageInfo.Config.Cmd;
		}
		else {
			return callback(new Error('No CMD specified'));
		}
		docker.createContainer(createOpts, callback);
	});
}

// Get created image id from project source directory.
// It should contain a file in projectRoot/.resin/image.
function getImageId(projectPath, callback) {
	const imageIdPath = path.join(projectPath, '.resin', 'image')
	fs.readFile(imageIdPath, 'utf8', (err, imageId) => {
		if (err) return callback(new Error('Could not find built image. Did you run `resin build`?'));
		else callback(null, imageId.trim());
	});
}

// Handle started container.
// Print useful information about the container.
function onContainerStart(container, callback) {
	container.inspect((err, containerInfo) => {
		if (err) return callback(err);
		console.log('Started container');
		console.log('Id: ' + containerInfo.Id);
		console.log('IP Address: ' + containerInfo.NetworkSettings.IPAddress);
		console.log('');
		console.log(`Use \`docker logs ${containerInfo.Id.substr(0,6)}\` to view logs, or \`docker stop ${containerInfo.Id.substr(0,6)}\` to stop the container.`);
		console.log(`Visit http://${containerInfo.NetworkSettings.IPAddress} if your container is running an http server.`);
		callback();
	});
}

// Use dockerode to start container.
function startContainer(container, callback) {
	container.start({ Privileged: true }, (err) => {
		if (err) return callback(err);
		onContainerStart(container, callback);
	});
}

// Main function. Get created image id and run it with docker.
function run(opts) {
	const projectPath = path.resolve(opts.path || '.');
	const callback = opts.callback || function() {};
	getImageId(projectPath, (err, imageId) => {
		if (err) return callback(err);
		createContainer(imageId, (err, container) => {
			if (err) return callback(err);
			startContainer(container, callback);
		});
	});
}

module.exports = {
	signature: 'run [path]',
	description: 'run your previously built application locally (run `resin build` first)',
	help: `Run your application locally.

Requires docker to be installed and running.`,
	action: function(params, options, done) {
		run({ path: params[0], callback: done });
	}
};
