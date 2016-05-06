"use strict";
const path = require('path');
const fs = require('fs');
const Docker = require('dockerode');
const Promise = require('bluebird');

const DOCKER_SOCKET = '/var/run/docker.sock'

// Get a docker connection object that is bluebird Promise compatible.
function getDockerConnection() {
	let docker = Promise.promisifyAll(new Docker({ socketPath: DOCKER_SOCKET }));
	// Hack dockerode to promisify internal classes' prototypes
	Promise.promisifyAll(docker.getImage().constructor.prototype);
	Promise.promisifyAll(docker.getContainer().constructor.prototype);
	return docker;
}

// Use dockerode to create a container that has ARM instructions
// but is emulated for x86 in qemu.
function createContainer({ imageId, name }) {
	let docker = getDockerConnection();
	let createOpts = {
		name: name,
		Image: imageId,
		Tty: false,
		Env: [ 'QEMU_EXECVE=1' ],
		Entrypoint: 'qemu-arm-static'
	};
	return docker.getImage(imageId).inspectAsync()
	.then((imageInfo) => {
		if (imageInfo && imageInfo.Config && imageInfo.Config.Cmd) {
			createOpts.Cmd = imageInfo.Config.Cmd;
		}
		else {
			throw new Error('No CMD specified');
		}
		return docker.createContainerAsync(createOpts);
	})
	.catch((err) => {
		if (err.statusCode === 409) {
			throw new Error(`Container ${name} already exists. Run \`docker rm -f ${name}\` and \`resin run\` to restart.`)
		}
		else {
			throw err;
		}
	});
}

// Get created image id from project source directory.
// It should contain a file in projectRoot/.resin/image.
// If the file does not exist it means the project has 
// not been built yet.
function getImageId(projectPath) {
	const imageIdPath = path.join(projectPath, '.resin', 'image')
	return fs.readFileAsync(imageIdPath, 'utf8')
	.catch((err) => {
		throw new Error('Could not find built image. Did you run `resin build`?');
	})
	.call('trim');
}

// Handle started container.
// Print useful information about the container.
function onContainerStart(container) {
	return container.inspectAsync()
	.then((containerInfo) => {
		const containerName = containerInfo.Name.substr(1) // docker response includes a / as first character
		console.log('Started container');
		console.log('Id: ' + containerInfo.Id);
		console.log('Name: ' + containerName);
		console.log('IP Address: ' + containerInfo.NetworkSettings.IPAddress);
		console.log('');
		console.log(`Use \`docker logs ${containerName}\` to view logs, or \`docker stop ${containerName}\` to stop the container.`);
		console.log(`Visit http://${containerInfo.NetworkSettings.IPAddress} if your container is running an http server.`);
	});
}

// Use dockerode to start container.
function startContainer(container) {
	return container.startAsync({ Privileged: true }).return(container);
}

function getContainerName(projectPath) {
	return 'resin_' + path.basename(projectPath).replace(/[^a-zA-Z0-9_]/g, '')
}

// Main function. Get created image id and run it with docker.
function run(opts) {
	const projectPath = path.resolve(opts.path || '.');
	const containerName = getContainerName(projectPath);
	return getImageId(projectPath)
	.then((imageId) => createContainer({ imageId: imageId, name: containerName }))
	.then((container) => startContainer(container))
	.then((container) => onContainerStart(container));
}

module.exports = {
	signature: 'run [path]',
	description: 'run your previously built application locally (run `resin build` first)',
	help: `Run your application locally.

Requires docker to be installed and running.`,
	action: function(params, options, done) {
		run({ path: params[0] })
		.asCallback(done);
	}
};
