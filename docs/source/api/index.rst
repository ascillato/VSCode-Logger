API Reference
=============

The API documentation is generated from Doxygen XML. Ensure ``doxygen Doxyfile`` has been run before building Sphinx so Breathe can locate ``docs/xml``.

.. ifconfig:: have_doxygen

   .. doxygenfile:: configuration.ts
      :project: VSCode-Logger

   .. doxygenfile:: deviceTree.ts
      :project: VSCode-Logger

   .. doxygenfile:: extension.ts
      :project: VSCode-Logger

   .. doxygenfile:: hostEndpoints.ts
      :project: VSCode-Logger

   .. doxygenfile:: logPanel.ts
      :project: VSCode-Logger

   .. doxygenfile:: logSession.ts
      :project: VSCode-Logger

   .. doxygenfile:: passwordManager.ts
      :project: VSCode-Logger

   .. doxygenfile:: sshCommandRunner.ts
      :project: VSCode-Logger

   .. doxygenfile:: sshTerminal.ts
      :project: VSCode-Logger

   .. doxygenfile:: ssh2.d.ts
      :project: VSCode-Logger

   .. doxygenfile:: loggerPanel.js
      :project: VSCode-Logger

   .. doxygenfile:: sidebarView.js
      :project: VSCode-Logger

   .. doxygenfile:: sftpExplorer.js
      :project: VSCode-Logger

   .. doxygenfile:: sftpExplorer.ts
      :project: VSCode-Logger

   .. doxygenfile:: sidebarView.ts
      :project: VSCode-Logger

.. ifconfig:: not have_doxygen

   .. note::

      Doxygen XML was not found at ``docs/xml``. Run ``doxygen Doxyfile``
      before building the docs to generate the API reference.
